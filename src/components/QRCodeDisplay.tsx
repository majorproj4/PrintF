'use client';

import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

interface QRCodeDisplayProps {
  url: string;
}

export function QRCodeDisplay({ url }: QRCodeDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current && url) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      }, (error) => {
        if (error) console.error('QR Code error:', error);
      });
    }
  }, [url]);

  return (
    <div className="p-4 bg-white rounded-2xl shadow-xl overflow-hidden">
      <canvas ref={canvasRef} className="max-w-full" />
    </div>
  );
}
