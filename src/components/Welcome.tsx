import { FileText, Lock, Server, FolderUp, FolderOpen, RefreshCw, MonitorDown } from 'lucide-react'
import type { AppStatus } from '../hooks/useNotes'

interface Props {
  status: AppStatus
  folderName: string | null
  canInstall: boolean
  onChooseDirectory: () => void
  onReconnect: () => void
  onContinueWithoutFolder: () => void
  onInstall: () => void
}

const BASE_FEATURES = [
  {
    icon: FileText,
    title: 'Real files, not a database',
    body: 'Every note is saved as its own self-contained .html file — readable in any browser, greppable, backed up, or moved with a simple copy-paste.',
  },
  {
    icon: Lock,
    title: 'Your device, your control',
    body: "There's no account and no server. htmlr only reads and writes inside the folder you choose — your notes never leave your device unless you move them.",
  },
]

// This one's only true on a Chromium browser (Chrome, Edge) — folder access doesn't exist
// elsewhere, so a Safari/Firefox visitor gets a card describing what they *can* actually do.
const SYNC_FEATURE = {
  icon: Server,
  title: 'Bring your own sync',
  body: 'Point the folder at a mapped NAS share (Synology, QNAP, TrueNAS…) or a mounted Google Drive to read and write the same notes from every device on your network.',
}

const MOVE_FEATURE = {
  icon: FolderUp,
  title: 'Move notes between devices',
  body: 'No folder access in this browser, but notes still travel: download any note as a real .html file from the toolbar and move it wherever you like.',
}

export function Welcome({ status, folderName, canInstall, onChooseDirectory, onReconnect, onContinueWithoutFolder, onInstall }: Props) {
  const features = [...BASE_FEATURES, status === 'unsupported' ? MOVE_FEATURE : SYNC_FEATURE]

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-brand">
          <img src="/logo.svg" alt="" className="welcome-logo" />
          <span>htmlr</span>
        </div>

        {status === 'needs-permission' ? (
          <>
            <h1 className="welcome-title">Reconnect your notes folder</h1>
            <p className="welcome-lede">
              htmlr needs permission again to read and write to{' '}
              <span className="welcome-folder-name">{folderName ?? 'your folder'}</span>. Your notes haven't moved —
              this is just your browser re-confirming access.
            </p>
            <div className="welcome-actions">
              <button className="btn-primary" onClick={onReconnect}>
                <RefreshCw size={15} />
                Grant access
              </button>
              <button className="btn-secondary" onClick={onChooseDirectory}>
                Choose a different folder
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="welcome-title">Your notes. Your device. Your control.</h1>
            <p className="welcome-lede">
              htmlr is a distraction-free rich-text editor that stores everything you write as plain HTML files on
              your own device — never on a company's server.
            </p>

            <div className="welcome-features">
              {features.map(({ icon: Icon, title, body }) => (
                <div className="welcome-feature" key={title}>
                  <div className="welcome-feature-icon">
                    <Icon size={16} />
                  </div>
                  <div>
                    <div className="welcome-feature-title">{title}</div>
                    <div className="welcome-feature-body">{body}</div>
                  </div>
                </div>
              ))}
            </div>

            {status === 'unsupported' ? (
              <>
                <div className="welcome-actions">
                  <button className="btn-primary" onClick={onContinueWithoutFolder}>
                    Continue in this browser
                  </button>
                </div>
                <p className="welcome-note">
                  On-device folder storage needs a Chromium-based browser (Chrome, Edge). You can still fully write
                  and edit notes here — they're kept in this browser's storage, and you can download any note as a
                  real .html file any time.
                </p>
              </>
            ) : (
              <>
                <div className="welcome-actions">
                  <button className="btn-primary" onClick={onChooseDirectory}>
                    <FolderOpen size={15} />
                    Choose a folder to get started
                  </button>
                </div>
                <p className="welcome-note">
                  You'll be asked to grant folder access — htmlr only touches the .html files inside the folder you
                  pick.
                </p>
              </>
            )}
          </>
        )}

        {canInstall && (
          <div className="welcome-install">
            <div>
              <div className="welcome-install-title">Install htmlr as an app</div>
              <div className="welcome-install-body">
                Runs in its own window and keeps working offline once installed — no browser tab needed.
              </div>
            </div>
            <button className="btn-secondary" onClick={onInstall}>
              <MonitorDown size={15} />
              Install
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
