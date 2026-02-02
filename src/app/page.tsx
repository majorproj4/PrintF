'use client';

import { useEffect, useState, useRef } from 'react';
import { nanoid } from 'nanoid';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Download, FileText, Smartphone, Laptop, CheckCircle2, 
  Clock, Loader2, Check, Zap, Heart, Copy, Lock, 
  Unlock, Users, History, Eye, MessageSquare, ExternalLink, X,
  ShieldCheck, AlertCircle
} from 'lucide-react';

interface SharedFile {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  content_type: string;
  created_at: string;
}

interface SharedMessage {
  id: string;
  content: string;
  type: 'text' | 'url';
  created_at: string;
}

interface PresenceState {
  user_id: string;
  device_type: 'mobile' | 'desktop';
  device_name: string;
  online_at: string;
}

interface UploadProgress {
  id: string;
  fileName: string;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  error?: string;
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [messages, setMessages] = useState<SharedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState('');
  const [downloadingFiles, setDownloadingFiles] = useState<Record<string, 'loading' | 'success' | null>>({});
  const [isLocked, setIsLocked] = useState(false);
  const [presence, setPresence] = useState<Record<string, PresenceState>>({});
  const [history, setHistory] = useState<SharedFile[]>([]);
  const [previewFile, setPreviewFile] = useState<SharedFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'files' | 'messages' | 'history'>('files');
  const [uploadProgress, setUploadProgress] = useState<Record<string, UploadProgress>>({});
  const [showApproval, setShowApproval] = useState(false);
  const [pendingDevice, setPendingDevice] = useState<PresenceState | null>(null);

  const prevPresenceCount = useRef(0);

  useEffect(() => {
    setBaseUrl(window.location.origin);
    const id = nanoid(10);
    setSessionId(id);
    createSession(id);
    
    const savedHistory = localStorage.getItem('transfer_history');
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
  }, []);

  const createSession = async (id: string) => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    
    const { error } = await supabase
      .from('sessions')
      .insert({
        session_id: id,
        expires_at: expiresAt,
        status: 'active',
        is_locked: false
      });

    if (error) {
      console.error('Error creating session:', error);
    } else {
      setLoading(false);
      subscribeToSession(id);
    }
  };

  const subscribeToSession = (id: string) => {
    const filesChannel = supabase
      .channel(`session-files-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'files',
          filter: `session_id=eq.${id}`
        },
        (payload) => {
          setFiles((current) => [payload.new as SharedFile, ...current]);
        }
      )
      .subscribe();

    const messagesChannel = supabase
      .channel(`session-messages-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `session_id=eq.${id}`
        },
        (payload) => {
          setMessages((current) => [payload.new as SharedMessage, ...current]);
        }
      )
      .subscribe();

    const sessionChannel = supabase
      .channel(`session-status-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sessions',
          filter: `session_id=eq.${id}`
        },
        (payload) => {
          setIsLocked(payload.new.is_locked);
        }
      )
      .subscribe();

    const progressChannel = supabase
      .channel(`progress-${id}`)
      .on('broadcast', { event: 'upload-progress' }, ({ payload }) => {
        setUploadProgress((current) => ({
          ...current,
          [payload.id]: payload as UploadProgress
        }));
        if (payload.status === 'completed' || payload.status === 'error') {
          setTimeout(() => {
            setUploadProgress((curr) => {
              const next = { ...curr };
              delete next[payload.id];
              return next;
            });
          }, 5000);
        }
      })
      .subscribe();

    const presenceChannel = supabase.channel(`presence-${id}`);
    
    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const formattedState: Record<string, PresenceState> = {};
        Object.keys(state).forEach((key) => {
          formattedState[key] = (state[key][0] as any) as PresenceState;
        });
        
        const connectedDevices = Object.values(formattedState);
        const mobileDevices = connectedDevices.filter(d => d.device_type === 'mobile');
        
        if (mobileDevices.length > 0 && prevPresenceCount.current === 0 && !isLocked) {
          setPendingDevice(mobileDevices[0]);
          setShowApproval(true);
        }
        
        prevPresenceCount.current = mobileDevices.length;
        setPresence(formattedState);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            user_id: nanoid(5),
            device_type: 'desktop',
            device_name: 'Main Desktop',
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(filesChannel);
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(sessionChannel);
      supabase.removeChannel(presenceChannel);
      supabase.removeChannel(progressChannel);
    };
  };

  const toggleLock = async () => {
    if (!sessionId) return;
    const newLockState = !isLocked;
    const { error } = await supabase
      .from('sessions')
      .update({ is_locked: newLockState })
      .eq('session_id', sessionId);
    
    if (!error) setIsLocked(newLockState);
  };

  const approveAndLock = async () => {
    if (!sessionId) return;
    const { error } = await supabase
      .from('sessions')
      .update({ is_locked: true })
      .eq('session_id', sessionId);
    
    if (!error) {
      setIsLocked(true);
      setShowApproval(false);
      setPendingDevice(null);
    }
  };

  const downloadFile = async (file: SharedFile) => {
    if (downloadingFiles[file.id]) return;
    setDownloadingFiles(prev => ({ ...prev, [file.id]: 'loading' }));

    try {
      const { data, error } = await supabase.storage
        .from('shared-files')
        .createSignedUrl(file.file_path, 60);

      if (error || !data?.signedUrl) throw error;

      const response = await fetch(data.signedUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.file_name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setDownloadingFiles(prev => ({ ...prev, [file.id]: 'success' }));
      
      const newHistory = [file, ...history.filter(h => h.id !== file.id)].slice(0, 50);
      setHistory(newHistory);
      localStorage.setItem('transfer_history', JSON.stringify(newHistory));

      setTimeout(() => {
        setDownloadingFiles(prev => ({ ...prev, [file.id]: null }));
      }, 2000);
    } catch (err) {
      console.error('Download failed:', err);
      setDownloadingFiles(prev => ({ ...prev, [file.id]: null }));
    }
  };

  const handlePreview = async (file: SharedFile) => {
    if (file.file_size > 50 * 1024 * 1024) {
      alert('File is too large for preview.');
      return;
    }
    setPreviewFile(file);
    setIsPreviewLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from('shared-files')
        .createSignedUrl(file.file_path, 300);
      if (error || !data?.signedUrl) throw error;
      setPreviewUrl(data.signedUrl);
    } catch (err) {
      console.error('Preview failed:', err);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (!sessionId) return null;

  const shareUrl = `${baseUrl}/session/${sessionId}`;
  const connectedDevices = Object.values(presence);
  const activeUploads = Object.values(uploadProgress);

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans overflow-x-hidden selection:bg-indigo-500/30 flex flex-col">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 blur-[120px] rounded-full" />
      </div>

      <main className="relative z-10 container mx-auto px-6 py-12 flex flex-col items-center flex-1">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Zap className="w-7 h-7 text-white fill-white" />
            </div>
            <span className="text-4xl font-black tracking-tighter">printf</span>
          </div>
          <h1 className="text-5xl font-bold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
            Instant File Transfer
          </h1>
          <div className="flex flex-wrap items-center justify-center gap-4 mt-6">
            <div className="flex items-center gap-2 bg-zinc-900/80 px-4 py-2 rounded-full border border-zinc-800 backdrop-blur-md">
              <Users className="w-4 h-4 text-indigo-400" />
              <span className="text-sm font-medium">{connectedDevices.length} Connected</span>
            </div>
            <button 
              onClick={toggleLock}
              className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all duration-300 backdrop-blur-md ${
                isLocked 
                  ? 'bg-red-500/10 border-red-500/50 text-red-400' 
                  : 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400'
              }`}
            >
              {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
              <span className="text-sm font-medium">{isLocked ? 'Session Locked' : 'Session Open'}</span>
            </button>
            <div className="flex -space-x-2">
              <AnimatePresence>
                {connectedDevices.map((device, i) => (
                  <motion.div
                    key={device.user_id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ delay: i * 0.1 }}
                    className={`w-8 h-8 rounded-full border-2 border-zinc-950 flex items-center justify-center ${
                      device.device_type === 'desktop' ? 'bg-indigo-500' : 'bg-purple-500'
                    }`}
                    title={`${device.device_name} (${device.device_type})`}
                  >
                    {device.device_type === 'desktop' ? <Laptop className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 w-full max-w-6xl items-start">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }} className="flex flex-col items-center">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-[2rem] blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
              <div className="relative bg-zinc-900 border border-zinc-800 p-8 rounded-[2rem] shadow-2xl">
                <QRCodeDisplay url={shareUrl} />
                <div className="mt-6 flex items-center justify-center gap-2 text-zinc-400">
                  <Smartphone className="w-5 h-5" />
                  <span className="text-sm font-medium">Scan with your phone</span>
                </div>
              </div>
            </div>
            <div className="mt-8 flex items-center gap-4 text-zinc-500 bg-zinc-900/50 px-4 py-2 rounded-full border border-zinc-800">
              <Clock className="w-4 h-4" />
              <span className="text-sm">Expires in 15 minutes</span>
            </div>

            <AnimatePresence>
              {activeUploads.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="mt-12 w-full max-w-sm space-y-3"
                >
                  <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 px-2">Incoming Transfers</h3>
                  {activeUploads.map(upload => (
                    <div key={upload.id} className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-2xl">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium truncate pr-4">{upload.fileName}</span>
                        <span className="text-xs text-indigo-400 font-bold">{upload.progress}%</span>
                      </div>
                      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${upload.progress}%` }}
                          className={`h-full ${upload.status === 'error' ? 'bg-red-500' : 'bg-indigo-500'}`}
                        />
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }} className="bg-zinc-900/50 border border-zinc-800 rounded-3xl backdrop-blur-xl min-h-[500px] flex flex-col overflow-hidden">
            <div className="flex border-b border-zinc-800">
              {[
                { id: 'files', icon: FileText, label: 'Files' },
                { id: 'messages', icon: MessageSquare, label: 'Messages' },
                { id: 'history', icon: History, label: 'History' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-medium transition-colors relative ${
                    activeTab === tab.id ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  {tab.label}
                  {activeTab === tab.id && (
                    <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500" />
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
              <AnimatePresence mode="popLayout">
                {activeTab === 'files' && (
                  files.length === 0 ? (
                    <EmptyState icon={FileText} text="Waiting for files..." />
                  ) : (
                    files.map(file => (
                      <FileItem 
                        key={file.id} 
                        file={file} 
                        downloading={downloadingFiles[file.id]} 
                        onDownload={() => downloadFile(file)}
                        onPreview={() => handlePreview(file)}
                        formatSize={formatSize}
                      />
                    ))
                  )
                )}

                {activeTab === 'messages' && (
                  messages.length === 0 ? (
                    <EmptyState icon={MessageSquare} text="No messages yet..." />
                  ) : (
                    messages.map(msg => (
                      <MessageItem key={msg.id} message={msg} onCopy={() => {
                        navigator.clipboard.writeText(msg.content);
                        alert('Copied!');
                      }} />
                    ))
                  )
                )}

                {activeTab === 'history' && (
                  history.length === 0 ? (
                    <EmptyState icon={History} text="No transfer history..." />
                  ) : (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center px-2 mb-2">
                        <span className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Recent Downloads</span>
                        <button onClick={() => { setHistory([]); localStorage.removeItem('transfer_history'); }} className="text-xs text-red-400 hover:text-red-300 transition-colors">Clear</button>
                      </div>
                      {history.map(file => (
                        <FileItem 
                          key={`hist-${file.id}`} 
                          file={file} 
                          downloading={downloadingFiles[file.id]} 
                          onDownload={() => downloadFile(file)}
                          onPreview={() => handlePreview(file)}
                          formatSize={formatSize}
                          isHistory
                        />
                      ))}
                    </div>
                  )
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </main>

      <AnimatePresence>
        {showApproval && pendingDevice && (
          <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-6">
            <motion.div 
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="bg-zinc-900 border border-indigo-500/50 p-6 rounded-[2rem] shadow-2xl backdrop-blur-xl"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-400">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Connection Request</h3>
                  <p className="text-zinc-400 text-sm">New device detected via QR scan</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowApproval(false)}
                  className="flex-1 py-3 px-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-bold transition-colors"
                >
                  Ignore
                </button>
                <button 
                  onClick={approveAndLock}
                  className="flex-2 py-3 px-6 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Approve & Lock
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {previewFile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="relative bg-zinc-900 rounded-3xl overflow-hidden max-w-4xl w-full max-h-[80vh] flex flex-col shadow-2xl border border-zinc-800">
              <div className="flex items-center justify-between p-4 border-b border-zinc-800">
                <h3 className="font-semibold truncate pr-8">{previewFile.file_name}</h3>
                <button onClick={() => { setPreviewFile(null); setPreviewUrl(null); }} className="p-2 hover:bg-zinc-800 rounded-full transition-colors"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex-1 overflow-auto bg-zinc-950 flex items-center justify-center min-h-[300px]">
                {isPreviewLoading ? (
                  <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                ) : previewUrl ? (
                  previewFile.content_type.startsWith('image/') ? (
                    <img src={previewUrl} alt={previewFile.file_name} className="max-w-full max-h-full object-contain" />
                  ) : previewFile.content_type.startsWith('video/') ? (
                    <video src={previewUrl} controls className="max-w-full max-h-full" />
                  ) : previewFile.content_type === 'application/pdf' ? (
                    <iframe src={`${previewUrl}#toolbar=0`} className="w-full h-full min-h-[500px]" />
                  ) : (
                    <div className="text-zinc-500 flex flex-col items-center">
                      <FileText className="w-16 h-16 mb-4 opacity-20" />
                      <p>Preview not available for this file type</p>
                    </div>
                  )
                ) : null}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="relative z-10 py-12 border-t border-zinc-900 mt-12 bg-zinc-950/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 flex flex-col items-center gap-4">
          <div className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors">
            <span className="text-sm font-medium">Made with</span>
            <Heart className="w-4 h-4 text-red-500 fill-red-500" />
            <span className="text-sm font-medium">by</span>
            <span className="text-sm font-bold text-white px-2 py-1 bg-zinc-900 rounded-lg border border-zinc-800">Rahul Vishwakarma</span>
          </div>
          <div className="flex items-center gap-6 text-[10px] text-zinc-600 font-bold uppercase tracking-widest">
            <span>© 2026 printf. Privacy-first design.</span>
          </div>
        </div>
      </footer>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #27272a; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
      `}</style>
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: any, text: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col items-center justify-center text-zinc-500 py-20">
      <div className="w-16 h-16 bg-zinc-800/50 rounded-2xl flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 opacity-20" />
      </div>
      <p className="text-sm italic font-medium">{text}</p>
    </motion.div>
  );
}

function FileItem({ file, downloading, onDownload, onPreview, formatSize, isHistory }: any) {
  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="group relative bg-zinc-800/40 border border-zinc-700/50 p-4 rounded-2xl hover:bg-zinc-800/60 transition-all duration-300">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform">
          <FileText className="w-6 h-6" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate pr-8">{file.file_name}</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {formatSize(file.file_size)} • {new Date(file.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onPreview} className="p-2 bg-zinc-700/50 hover:bg-zinc-700 rounded-lg transition-colors text-zinc-300 hover:text-white"><Eye className="w-4 h-4" /></button>
          <button 
            onClick={onDownload}
            disabled={downloading === 'loading'}
            className={`p-2 rounded-lg transition-all duration-300 text-white flex items-center justify-center min-w-[36px] min-h-[36px] ${
              downloading === 'success' ? 'bg-emerald-500 shadow-emerald-500/20' : 
              downloading === 'loading' ? 'bg-zinc-700 opacity-50 cursor-not-allowed' : 
              'bg-zinc-700/50 hover:bg-indigo-600 shadow-indigo-500/20'
            }`}
          >
            {downloading === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : 
             downloading === 'success' ? <Check className="w-4 h-4" /> : 
             <Download className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function MessageItem({ message, onCopy }: any) {
  const isUrl = message.type === 'url' || message.content.startsWith('http');
  return (
    <motion.div layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="group relative bg-zinc-800/40 border border-zinc-700/50 p-4 rounded-2xl hover:bg-zinc-800/60 transition-all duration-300">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center text-purple-400">
          {isUrl ? <ExternalLink className="w-5 h-5" /> : <MessageSquare className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-200 break-words line-clamp-3">{message.content}</p>
          <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wider font-bold">
            {isUrl ? 'Link' : 'Text'} • {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isUrl && <a href={message.content} target="_blank" rel="noopener noreferrer" className="p-2 bg-zinc-700/50 hover:bg-zinc-700 rounded-lg text-zinc-300 hover:text-white"><ExternalLink className="w-4 h-4" /></a>}
          <button onClick={onCopy} className="p-2 bg-zinc-700/50 hover:bg-zinc-700 rounded-lg text-zinc-300 hover:text-white"><Copy className="w-4 h-4" /></button>
        </div>
      </div>
    </motion.div>
  );
}
