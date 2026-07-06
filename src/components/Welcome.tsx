import { FileText, Lock, Server, FolderOpen, RefreshCw } from 'lucide-react'
import type { AppStatus } from '../hooks/useNotes'

interface Props {
  status: AppStatus
  folderName: string | null
  onChooseDirectory: () => void
  onReconnect: () => void
  onContinueWithoutFolder: () => void
}

const FEATURES = [
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
  {
    icon: Server,
    title: 'Bring your own sync',
    body: 'Point the folder at a mapped NAS share (Synology, QNAP, TrueNAS…) to read and write the same notes from every device on your network — no subscription required.',
  },
]

export function Welcome({ status, folderName, onChooseDirectory, onReconnect, onContinueWithoutFolder }: Props) {
  if (status === 'checking') {
    return <div className="welcome" />
  }

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
              {FEATURES.map(({ icon: Icon, title, body }) => (
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
                  On-device folder storage needs a Chromium-based browser (Chrome, Edge). You can still use htmlr
                  here — notes will be kept in this browser's local storage instead.
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
      </div>
    </div>
  )
}
