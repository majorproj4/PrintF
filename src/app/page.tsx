'use client';

import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, FileText, Smartphone, Laptop, CheckCircle2, Clock, Loader2, Check, Zap, Heart } from 'lucide-react';

interface SharedFile {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  content_type: string;
  created_at: string;
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [baseUrl, setBaseUrl] = useState('');
  const [downloadingFiles, setDownloadingFiles] = useState<Record<string, 'loading' | 'success' | null>>({});

  useEffect(() => {
    setBaseUrl(window.location.origin);
    const id = nanoid(10);
    setSessionId(id);
    createSession(id);
  }, []);

  const createSession = async (id: string) => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    
    const { error } = await supabase
      .from('sessions')
      .insert({
        session_id: id,
        expires_at: expiresAt,
        status: 'active'
      });

    if (error) {
      console.error('Error creating session:', error);
    } else {
      setLoading(false);
      subscribeToFiles(id);
    }
  };

  const subscribeToFiles = (id: string) => {
    const channel = supabase
      .channel(`session-${id}`)
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

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const downloadFile = async (file: SharedFile) => {
    if (downloadingFiles[file.id]) return;

    setDownloadingFiles(prev => ({ ...prev, [file.id]: 'loading' }));

    try {
      const { data, error } = await supabase.storage
        .from('shared-files')
        .createSignedUrl(file.file_path, 60);

      if (error || !data?.signedUrl) throw error;

      // Force download using fetch + blob
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
      
      // Reset success state after 2 seconds
      setTimeout(() => {
        setDownloadingFiles(prev => ({ ...prev, [file.id]: null }));
      }, 2000);
    } catch (err) {
      console.error('Download failed:', err);
      setDownloadingFiles(prev => ({ ...prev, [file.id]: null }));
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

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans overflow-hidden selection:bg-indigo-500/30 flex flex-col">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 blur-[120px] rounded-full" />
      </div>

      <main className="relative z-10 container mx-auto px-6 py-12 flex flex-col items-center flex-1">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-16"
        >
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Zap className="w-7 h-7 text-white fill-white" />
            </div>
            <span className="text-4xl font-black tracking-tighter">printf</span>
          </div>
          <h1 className="text-5xl font-bold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
            Instant File Transfer
          </h1>
          <p className="text-zinc-400 text-lg max-w-md mx-auto">
            Drop files anywhere. Scan the QR code to start transferring files instantly between any device.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 w-full max-w-5xl items-start">
          {/* Left Side: QR Code */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="flex flex-col items-center"
          >
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
              <span className="text-sm">Session expires in 15 minutes</span>
            </div>
          </motion.div>

          {/* Right Side: Files List */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-8 backdrop-blur-xl min-h-[400px] flex flex-col"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Laptop className="w-5 h-5 text-indigo-400" />
                Received Files
              </h2>
              <span className="bg-indigo-500/10 text-indigo-400 text-xs font-bold px-2 py-1 rounded uppercase tracking-wider">
                {files.length} {files.length === 1 ? 'file' : 'files'}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
              <AnimatePresence mode="popLayout">
                {files.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="h-full flex flex-col items-center justify-center text-zinc-500 py-12"
                  >
                    <div className="w-16 h-16 bg-zinc-800/50 rounded-2xl flex items-center justify-center mb-4">
                      <FileText className="w-8 h-8 opacity-20" />
                    </div>
                    <p className="text-sm">Waiting for files...</p>
                  </motion.div>
                ) : (
                  files.map((file) => (
                    <motion.div
                      key={file.id}
                      layout
                      initial={{ opacity: 0, scale: 0.8, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className="group relative bg-zinc-800/40 border border-zinc-700/50 p-4 rounded-2xl hover:bg-zinc-800/60 transition-all duration-300"
                    >
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
                        <button 
                          onClick={() => downloadFile(file)}
                          disabled={downloadingFiles[file.id] === 'loading'}
                          className={`p-2 rounded-lg transition-all duration-300 text-white group-hover:shadow-lg flex items-center justify-center min-w-[36px] min-h-[36px] ${
                            downloadingFiles[file.id] === 'success' 
                              ? 'bg-emerald-500 shadow-emerald-500/20' 
                              : downloadingFiles[file.id] === 'loading'
                              ? 'bg-zinc-700 opacity-50 cursor-not-allowed'
                              : 'bg-zinc-700/50 hover:bg-indigo-600 shadow-indigo-500/20'
                          }`}
                        >
                          <AnimatePresence mode="wait">
                            {downloadingFiles[file.id] === 'loading' ? (
                              <motion.div
                                key="loading"
                                initial={{ opacity: 0, rotate: -180 }}
                                animate={{ opacity: 1, rotate: 0 }}
                                exit={{ opacity: 0, rotate: 180 }}
                              >
                                <Loader2 className="w-4 h-4 animate-spin" />
                              </motion.div>
                            ) : downloadingFiles[file.id] === 'success' ? (
                              <motion.div
                                key="success"
                                initial={{ opacity: 0, scale: 0.5 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.5 }}
                              >
                                <Check className="w-4 h-4" />
                              </motion.div>
                            ) : (
                              <motion.div
                                key="idle"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                              >
                                <Download className="w-4 h-4" />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </button>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>

            <div className="mt-6 pt-6 border-t border-zinc-800">
              <div className="flex items-center gap-3 text-emerald-400/80">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs font-medium">Real-time connection active for 15 min</span>
              </div>
            </div>
          </motion.div>
        </div>
      </main>

      <footer className="relative z-10 py-12 border-t border-zinc-900 mt-12 bg-zinc-950/50 backdrop-blur-sm">
        <div className="container mx-auto px-6 flex flex-col items-center gap-4">
          <div className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 transition-colors">
            <span className="text-sm">Made with</span>
            <Heart className="w-4 h-4 text-red-500 fill-red-500" />
            <span className="text-sm">by</span>
            <span className="text-sm font-semibold text-white">Rahul Vishwakarma</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-zinc-600">
            <span>© 2026 printf. All rights reserved.</span>
          </div>
        </div>
      </footer>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
      `}</style>
    </div>
  );
}
