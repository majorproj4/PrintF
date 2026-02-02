## Project Summary
printf is a professional, real-time file-sharing platform that allows users to instantly transfer files between devices using a randomly generated QR code. A desktop user generates a session, and a mobile user scans the QR code to upload files, which appear instantly on the desktop for download.

## Tech Stack
- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database & Storage**: Supabase (PostgreSQL + Storage)
- **Real-time**: Supabase Realtime (Postgres Changes + Broadcast + Presence)
- **Animations**: Framer Motion
- **Icons**: Lucide React
- **QR Generation**: qrcode

## Architecture
- `src/app/page.tsx`: Main desktop interface. Handles session generation, QR code display, file/message listening, device presence list, connection approval, and local history.
- `src/app/session/[id]/page.tsx`: Mobile upload interface. Handles session validation, file uploads to Supabase Storage, and metadata recording. Broadcasts upload progress.
- `src/lib/supabase.ts`: Supabase client configuration.
- `src/components/QRCodeDisplay.tsx`: Canvas-based QR code generator.

## User Preferences
- No login or authentication required.
- Dark mode primary aesthetic (zinc-950).
- Smooth animations with Framer Motion.
- Minimal, glassmorphic UI.
- Privacy-first design with session locking.

## Project Guidelines
- Sessions expire after 15 minutes.
- Files are scoped by `session_id`.
- Real-time updates are handled by subscribing to the `files` table changes.
- Downloads are provided via Supabase Signed URLs for security.
- Automatic locking after the first device connection approval.

## Common Patterns
- Real-time subscription: `supabase.channel(id).on('postgres_changes', ...).subscribe()`
- Broadcast messages: `channel.send({ type: 'broadcast', event: '...', payload: { ... } })`
- Presence tracking: `channel.on('presence', { event: 'sync' }, ...).track({ ... })`
- Local transfer history using browser `localStorage`.
