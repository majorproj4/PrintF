'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Upload, File, X, CheckCircle2, AlertCircle, 
  Loader2, ArrowLeft, Zap, Heart, MessageSquare, 
  Send, Smartphone, Users, Lock
} from 'lucide-react';
import { nanoid } from 'nanoid';

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  error?: string;
}

export default function SessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;
  
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState('');
  const [isSendingMsg, setIsSendingMsg] = useState(false);
  const [presenceCount, setPresenceCount] = useState(0);

  useEffect(() => {
    checkSession();
    const channels = subscribeToSession();
    return () => {
      channels.forEach(channel => supabase.removeChannel(channel));
    };
  }, [sessionId]);

  const checkSession = async () => {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('session_id', sessionId)
      .eq('status', 'active')
      .single();

    if (error || !data) {
      setIsValid(false);
    } else {
      const expiresAt = new Date(data.expires_at);
      if (expiresAt < new Date()) {
        setIsValid(false);
      } else {
        setIsValid(true);
        setIsLocked(data.is_locked);
      }
    }
  };

  const subscribeToSession = () => {
    const sessionChannel = supabase
      .channel(`session-status-mobile-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sessions',
          filter: `session_id=eq.${sessionId}`
        },
        (payload) => {
          setIsLocked(payload.new.is_locked);
        }
      )
      .subscribe();

    const presenceChannel = supabase.channel(`presence-${sessionId}`);
    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        setPresenceCount(Object.keys(state).length);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            user_id: nanoid(5),
            device_type: 'mobile',
            device_name: 'Mobile Device',
            online_at: new Date().toISOString(),
          });
        }
      });

    const progressChannel = supabase.channel(`progress-${sessionId}`);
    progressChannel.subscribe();

    return [sessionChannel, presenceChannel, progressChannel];
  };

  const uploadFile = async (uploadingFile: UploadingFile) => {
    const { file, id } = uploadingFile;
    const filePath = `sessions/${sessionId}/${id}-${file.name}`;
    const progressChannel = supabase.channel(`progress-${sessionId}`);

    try {
      progressChannel.send({
        type: 'broadcast',
        event: 'upload-progress',
        payload: { id, fileName: file.name, progress: 0, status: 'uploading' }
      });

      const { data: storageData, error: storageError } = await supabase.storage
        .from('shared-files')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (storageError) throw storageError;

      const { error: dbError } = await supabase
        .from('files')
        .insert({
          session_id: sessionId,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          content_type: file.type
        });

      if (dbError) throw dbError;

      progressChannel.send({
        type: 'broadcast',
        event: 'upload-progress',
        payload: { id, fileName: file.name, progress: 100, status: 'completed' }
      });

      setUploadingFiles(prev => 
        prev.map(f => f.id === id ? { ...f, status: 'completed', progress: 100 } : f)
      );
    } catch (err: any) {
      console.error('Upload error:', err);
      progressChannel.send({
        type: 'broadcast',
        event: 'upload-progress',
        payload: { id, fileName: file.name, progress: 0, status: 'error', error: err.message }
      });
      setUploadingFiles(prev => 
        prev.map(f => f.id === id ? { ...f, status: 'error', error: err.message } : f)
      );
    }
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(Array.from(e.target.files));
    }
  };

  const handleFiles = (files: File[]) => {
    if (isLocked) {
      alert('This session is locked by the receiver.');
      return;
    }
    const newUploadingFiles = files.map(file => ({
      id: nanoid(9),
      file,
      progress: 0,
      status: 'uploading' as const
    }));

    setUploadingFiles(prev => [...newUploadingFiles, ...prev]);
    newUploadingFiles.forEach(uploadFile);
  };

  const sendMessage = async () => {
    if (!message.trim() || isSendingMsg || isLocked) return;
    setIsSendingMsg(true);
    try {
      const { error } = await supabase
        .from('messages')
        .insert({
          session_id: sessionId,
          content: message.trim(),
          type: message.startsWith('http') ? 'url' : 'text'
        });
      if (!error) setMessage('');
    } catch (err) {
      console.error('Send message failed:', err);
    } finally {
      setIsSendingMsg(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  if (isValid === null) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (isValid === false) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6">
          <AlertCircle className="w-10 h-10 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Session Expired</h1>
        <p className="text-zinc-400 mb-8 max-w-xs">This transfer session is no longer active or has expired.</p>
        <button onClick={() => router.push('/')} className="flex items-center gap-2 text-indigo-400 font-medium hover:text-indigo-300 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Go back home
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6 pb-32 font-sans overflow-x-hidden selection:bg-indigo-500/30">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Zap className="w-6 h-6 text-white fill-white" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tighter">printf</h1>
            <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-bold uppercase tracking-wider">
              <span>{sessionId.slice(0, 6)}</span>
              <span>•</span>
              <span className="flex items-center gap-1"><Users className="w-2.5 h-2.5" /> {presenceCount}</span>
            </div>
          </div>
        </div>
        <button onClick={() => router.push('/')} className="text-zinc-500 hover:text-white transition-colors">
          <X className="w-6 h-6" />
        </button>
      </header>

      <main className="max-w-md mx-auto space-y-8">
        {isLocked ? (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-red-500/10 border border-red-500/20 p-6 rounded-3xl text-center">
            <Lock className="w-10 h-10 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-red-400">Session Locked</h2>
            <p className="text-zinc-500 text-sm mt-1">The receiver has locked this session. You cannot send more files or messages.</p>
          </motion.div>
        ) : (
          <>
            <div
              onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
              className={`relative group h-64 border-2 border-dashed rounded-[2.5rem] flex flex-col items-center justify-center transition-all duration-300 ${
                isDragging ? 'border-indigo-500 bg-indigo-500/5 scale-[0.98]' : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'
              }`}
            >
              <input type="file" multiple onChange={onFileSelect} className="absolute inset-0 opacity-0 cursor-pointer" />
              <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <Upload className={`w-8 h-8 ${isDragging ? 'text-indigo-400' : 'text-zinc-500'}`} />
              </div>
              <p className="font-medium text-zinc-200">Tap to select files</p>
              <p className="text-zinc-500 text-sm mt-1">or drag and drop them here</p>
            </div>

            <div className="space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 px-2">Quick Message</h2>
              <div className="relative group">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Paste a link or type text..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-sm focus:outline-none focus:border-indigo-500/50 transition-colors resize-none h-24"
                />
                <button 
                  onClick={sendMessage}
                  disabled={!message.trim() || isSendingMsg}
                  className="absolute bottom-3 right-3 p-2 bg-indigo-600 rounded-xl text-white disabled:opacity-50 disabled:bg-zinc-800 transition-all active:scale-95"
                >
                  {isSendingMsg ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </>
        )}

        <div className="space-y-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 px-2">Upload Status</h2>
          <AnimatePresence initial={false}>
            {uploadingFiles.length === 0 ? (
              <p className="text-center text-zinc-600 py-8 italic text-sm">No files uploaded in this batch</p>
            ) : (
              uploadingFiles.map((file) => (
                <motion.div key={file.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-2xl flex items-center gap-4 backdrop-blur-sm">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    file.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                    file.status === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-indigo-500/10 text-indigo-400'
                  }`}>
                    {file.status === 'completed' ? <CheckCircle2 className="w-5 h-5" /> :
                     file.status === 'error' ? <AlertCircle className="w-5 h-5" /> : <File className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.file.name}</p>
                    <div className="mt-1.5 h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${file.progress}%` }} className={`h-full ${file.status === 'completed' ? 'bg-emerald-500' : file.status === 'error' ? 'bg-red-500' : 'bg-indigo-500'}`} />
                    </div>
                  </div>
                  {file.status === 'uploading' && <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />}
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>
        {uploadingFiles.some(f => f.status === 'completed') && (
          <motion.div initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }} className="fixed bottom-8 left-6 right-6 z-40">
            <button onClick={() => setUploadingFiles([])} className="w-full bg-white text-black font-bold py-4 rounded-2xl shadow-xl hover:bg-zinc-200 transition-colors">Clear Status List</button>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="mt-12 flex flex-col items-center gap-4 py-8 border-t border-zinc-900">
        <div className="flex items-center gap-2 text-zinc-500">
          <span className="text-xs">Made with</span>
          <Heart className="w-3 h-3 text-red-500 fill-red-500" />
          <span className="text-xs text-zinc-400">by Rahul Vishwakarma</span>
        </div>
      </footer>
    </div>
  );
}
