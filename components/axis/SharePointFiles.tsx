'use client'
// components/axis/SharePointFiles.tsx
// SharePoint file browser + drag-drop upload for AXIS project pages.
// Requires the user to be signed in with Microsoft (provider_token).

import { useState, useEffect, useRef, useCallback } from 'react'
import { getDb } from '@/lib/supabase/db'
import {
  listFiles, uploadFile, deleteFile, ensureFolder,
  projectFolderPath, fmtBytes,
  type SpFile,
} from '@/lib/integrations/sharepoint'
import {
  FolderOpen, Upload, File, FileText, FileImage, Trash2,
  ExternalLink, RefreshCw, AlertCircle, Loader2, FolderPlus,
} from 'lucide-react'

const FONT = { fontFamily: 'Arial, -apple-system, sans-serif' }

interface Props {
  projectCode: string   // e.g. "PRJ-001"
  projectName: string   // e.g. "Quality"
}

function fileIcon(f: SpFile) {
  if (f.isFolder) return <FolderOpen size={14} style={{ color: '#F59E0B' }} />
  const ext = f.name.split('.').pop()?.toLowerCase()
  if (['jpg','jpeg','png','gif','svg','webp'].includes(ext ?? '')) return <FileImage size={14} style={{ color: '#8B5CF6' }} />
  if (['pdf','doc','docx','xls','xlsx','ppt','pptx'].includes(ext ?? '')) return <FileText size={14} style={{ color: '#3B82F6' }} />
  return <File size={14} style={{ color: '#6B7280' }} />
}

export default function SharePointFiles({ projectCode, projectName }: Props) {
  const [token,     setToken]     = useState<string | null>(null)
  const [files,     setFiles]     = useState<SpFile[]>([])
  const [loading,   setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [creating,  setCreating]  = useState(false)
  const [folderUrl, setFolderUrl] = useState<string | null>(null)
  const [dragOver,  setDragOver]  = useState(false)
  const fileInput                 = useRef<HTMLInputElement>(null)

  const folderPath = projectFolderPath(projectCode, projectName)

  // ── Get Microsoft provider token ───────────────────────────────────────────
  useEffect(() => {
    getDb().auth.getSession().then(({ data: { session } }) => {
      const t = (session as any)?.provider_token as string | undefined
      setToken(t ?? null)
      setLoading(false)
    })
  }, [])

  // ── Load files ─────────────────────────────────────────────────────────────
  const loadFiles = useCallback(async (tok: string) => {
    setLoading(true); setError(null)
    try {
      const list = await listFiles(tok, folderPath)
      setFiles(list)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [folderPath])

  useEffect(() => {
    if (token) loadFiles(token)
    else setLoading(false)
  }, [token, loadFiles])

  // ── Create folder ──────────────────────────────────────────────────────────
  async function handleCreateFolder() {
    if (!token) return
    setCreating(true); setError(null)
    try {
      const url = await ensureFolder(token, folderPath)
      setFolderUrl(url)
      await loadFiles(token)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  // ── Upload ─────────────────────────────────────────────────────────────────
  async function handleUpload(fileList: FileList | null) {
    if (!token || !fileList || fileList.length === 0) return
    setUploading(true); setError(null)

    // Ensure folder exists first
    try { await ensureFolder(token, folderPath) } catch {}

    const results: SpFile[] = []
    for (const file of Array.from(fileList)) {
      try {
        const uploaded = await uploadFile(token, folderPath, file)
        results.push(uploaded)
      } catch (e: any) {
        setError(`Failed to upload "${file.name}": ${e.message}`)
      }
    }

    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name))
      return [...prev.filter(f => !results.find(r => r.name === f.name)), ...results]
        .filter(f => existing.has(f.name) || results.find(r => r.id === f.id))
    })

    // Refresh to get accurate list
    await loadFiles(token)
    setUploading(false)
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete(file: SpFile) {
    if (!token) return
    if (!confirm(`Delete "${file.name}"? This cannot be undone.`)) return
    try {
      await deleteFile(token, file.id)
      setFiles(prev => prev.filter(f => f.id !== file.id))
    } catch (e: any) {
      setError(e.message)
    }
  }

  // ── Drag & drop ────────────────────────────────────────────────────────────
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    handleUpload(e.dataTransfer.files)
  }

  // ── No Microsoft token ─────────────────────────────────────────────────────
  if (!loading && !token) {
    return (
      <div style={{ ...FONT, padding: '24px', background: '#F9FAFB', borderRadius: 10, border: '1px solid #E5E7EB', textAlign: 'center' }}>
        <FolderOpen size={28} style={{ color: '#D1D5DB', margin: '0 auto 12px' }} />
        <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', margin: '0 0 6px' }}>
          Microsoft sign-in required
        </p>
        <p style={{ fontSize: 12, color: '#6B7280', margin: 0, lineHeight: 1.5 }}>
          Sign out and sign back in using <strong>Sign in with Microsoft</strong> to access project files.
        </p>
      </div>
    )
  }

  return (
    <div style={{ ...FONT }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FolderOpen size={15} style={{ color: '#F59E0B' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Project Files
          </span>
          <span style={{ fontSize: 10, color: '#9CA3AF' }}>OneDrive · {folderPath}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {token && !loading && (
            <button
              onClick={() => loadFiles(token)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1px solid #E5E7EB', background: 'white', color: '#6B7280', fontSize: 11, cursor: 'pointer' }}
            >
              <RefreshCw size={11} /> Refresh
            </button>
          )}
          {folderUrl && (
            <a href={folderUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1px solid #DBEAFE', background: '#EFF6FF', color: '#2563EB', fontSize: 11, textDecoration: 'none' }}>
              <ExternalLink size={11} /> Open in SharePoint
            </a>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginBottom: 12 }}>
          <AlertCircle size={13} style={{ color: '#DC2626', flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12, color: '#DC2626' }}>{error}</span>
        </div>
      )}

      {/* Drop zone + upload button */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${dragOver ? '#1A3A0E' : '#E5E7EB'}`,
          borderRadius: 8,
          padding: '16px 20px',
          background: dragOver ? '#F0F7EC' : '#FAFAFA',
          textAlign: 'center',
          marginBottom: 12,
          transition: 'all 0.15s',
          cursor: 'pointer',
        }}
        onClick={() => !uploading && fileInput.current?.click()}
      >
        {uploading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: '#1A3A0E' }} />
            <span style={{ fontSize: 12, color: '#374151' }}>Uploading…</span>
          </div>
        ) : (
          <>
            <Upload size={18} style={{ color: '#9CA3AF', margin: '0 auto 6px' }} />
            <p style={{ fontSize: 12, color: '#374151', margin: '0 0 2px', fontWeight: 500 }}>
              Drop files here or click to upload
            </p>
            <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0 }}>
              Files save to <code style={{ fontSize: 10 }}>{projectCode}</code> in OneDrive
            </p>
          </>
        )}
        <input
          ref={fileInput} type="file" multiple style={{ display: 'none' }}
          onChange={e => handleUpload(e.target.files)}
        />
      </div>

      {/* File list */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '24px 0' }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: '#9CA3AF' }} />
          <span style={{ fontSize: 12, color: '#9CA3AF' }}>Loading files…</span>
        </div>
      ) : files.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '0 0 8px' }}>
            No files yet for this project.
          </p>
          <button
            onClick={handleCreateFolder}
            disabled={creating}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6, border: '1px solid #D1FAE5', background: '#ECFDF5', color: '#065F46', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
          >
            {creating ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <FolderPlus size={11} />}
            {creating ? 'Creating…' : `Create folder in SharePoint`}
          </button>
        </div>
      ) : (
        <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 32px', gap: 0, background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', padding: '7px 12px' }}>
            {['Name', 'Size', 'Modified', ''].map(h => (
              <span key={h} style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</span>
            ))}
          </div>
          {/* Rows */}
          {files.map(f => (
            <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 32px', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #F3F4F6', background: 'white' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                {fileIcon(f)}
                <a href={f.webUrl} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: '#111827', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={f.name}>
                  {f.name}
                </a>
              </div>
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>{f.isFolder ? '—' : fmtBytes(f.size)}</span>
              <span style={{ fontSize: 11, color: '#9CA3AF' }}>
                {new Date(f.lastModified).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: '2-digit' })}
              </span>
              <button
                onClick={() => !f.isFolder && handleDelete(f)}
                disabled={f.isFolder}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 4, border: 'none', background: 'transparent', cursor: f.isFolder ? 'default' : 'pointer', color: '#D1D5DB', opacity: f.isFolder ? 0 : 1 }}
                onMouseEnter={e => !f.isFolder && ((e.currentTarget as HTMLElement).style.color = '#EF4444')}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#D1D5DB')}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
