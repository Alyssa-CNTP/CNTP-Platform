// lib/integrations/sharepoint.ts
// Microsoft Graph API utilities for the AXIS SharePoint file integration.
// Uses the delegated provider_token from Supabase OAuth (Microsoft sign-in only).

export const SHAREPOINT_SITE  = 'rooibostea.sharepoint.com:/sites/TestAI'
export const PROJECTS_BASE    = '07_Projects & Portfolios/Active'

const GRAPH = 'https://graph.microsoft.com/v1.0'

export interface SpFile {
  id:          string
  name:        string
  size:        number
  webUrl:      string
  createdBy:   string
  lastModified: string
  isFolder:    boolean
  mimeType?:   string
}

// ─── Core fetch wrapper ────────────────────────────────────────────────────────

async function gFetch(token: string, path: string, opts: RequestInit = {}) {
  const res = await fetch(`${GRAPH}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message ?? `Graph API error ${res.status}`)
  }
  return res.status === 204 ? null : res.json()
}

// ─── Cached site + drive resolution ───────────────────────────────────────────

let _siteId:  string | null = null
let _driveId: string | null = null

export async function getSiteDrive(token: string) {
  if (_siteId && _driveId) return { siteId: _siteId, driveId: _driveId }

  const site  = await gFetch(token, `/sites/${SHAREPOINT_SITE}`)
  _siteId     = site.id

  const drive = await gFetch(token, `/sites/${_siteId}/drive`)
  _driveId    = drive.id

  return { siteId: _siteId!, driveId: _driveId! }
}

// ─── Folder helpers ───────────────────────────────────────────────────────────

/** Build the OneDrive path for a given AXIS project */
export function projectFolderPath(projectCode: string, projectName: string) {
  const slug = projectName
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
  return `${PROJECTS_BASE}/${projectCode}_${slug}`
}

/** List files in a folder path */
export async function listFiles(token: string, folderPath: string): Promise<SpFile[]> {
  const { driveId } = await getSiteDrive(token)
  const encodedPath  = encodeURIComponent(folderPath)

  try {
    const res = await gFetch(token,
      `/drives/${driveId}/root:/${encodedPath}:/children?$select=id,name,size,webUrl,file,folder,createdBy,lastModifiedDateTime`
    )
    return (res.value ?? []).map((item: any): SpFile => ({
      id:           item.id,
      name:         item.name,
      size:         item.size ?? 0,
      webUrl:       item.webUrl,
      createdBy:    item.createdBy?.user?.displayName ?? '—',
      lastModified: item.lastModifiedDateTime,
      isFolder:     !!item.folder,
      mimeType:     item.file?.mimeType,
    }))
  } catch (err: any) {
    // Folder doesn't exist yet
    if (err.message?.includes('itemNotFound') || err.message?.includes('404')) return []
    throw err
  }
}

/** Create a folder (no-op if already exists) */
export async function ensureFolder(token: string, folderPath: string): Promise<string> {
  const { driveId } = await getSiteDrive(token)
  const parts        = folderPath.split('/')
  const parentPath   = parts.slice(0, -1).join('/')
  const folderName   = parts[parts.length - 1]

  const encodedParent = encodeURIComponent(parentPath)

  const res = await gFetch(token,
    `/drives/${driveId}/root:/${encodedParent}:/children`,
    {
      method: 'POST',
      body: JSON.stringify({
        name:   folderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'rename',
      }),
    }
  )
  return res?.webUrl ?? ''
}

/** Upload a file to a folder path */
export async function uploadFile(
  token:      string,
  folderPath: string,
  file:       File
): Promise<SpFile> {
  const { driveId }   = await getSiteDrive(token)
  const filePath       = `${folderPath}/${file.name}`
  const encodedPath    = encodeURIComponent(filePath)
  const buffer         = await file.arrayBuffer()

  const res = await fetch(`${GRAPH}/drives/${driveId}/root:/${encodedPath}:/content`, {
    method:  'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: buffer,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message ?? `Upload failed ${res.status}`)
  }

  const item = await res.json()
  return {
    id:           item.id,
    name:         item.name,
    size:         item.size ?? file.size,
    webUrl:       item.webUrl,
    createdBy:    item.createdBy?.user?.displayName ?? '—',
    lastModified: item.lastModifiedDateTime,
    isFolder:     false,
    mimeType:     item.file?.mimeType ?? file.type,
  }
}

/** Delete a file by ID */
export async function deleteFile(token: string, fileId: string): Promise<void> {
  const { driveId } = await getSiteDrive(token)
  await gFetch(token, `/drives/${driveId}/items/${fileId}`, { method: 'DELETE' })
}

/** Format bytes to human-readable string */
export function fmtBytes(bytes: number) {
  if (bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
