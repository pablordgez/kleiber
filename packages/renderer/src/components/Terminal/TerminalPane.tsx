import React, { useEffect, useRef, useState } from 'react';
import { UUID } from '@kleiber/shared';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

// Delay (ms) before disposing an exited session's xterm instance.
const LAZY_DISPOSE_DELAY_MS = 5 * 60 * 1_000; // 5 minutes

export interface TerminalPaneProps {
  sessionId: UUID;
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({ sessionId }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);

  useEffect(() => {
    // If the xterm instance was lazily disposed from a previous mount, clear
    // the placeholder and recreate it when the user switches back.
    setSessionEnded(false);

    if (!terminalRef.current) return;
    setError(null);

    // Cancel any pending lazy-dispose timer from a previous lifecycle.
    if (disposeTimer.current !== null) {
      clearTimeout(disposeTimer.current);
      disposeTimer.current = null;
    }

    // Reuse an existing (not yet disposed) Terminal if we have one.
    if (!term.current) {
      term.current = new Terminal({
        theme: {
          background: '#000000',
          foreground: '#E5E5E5',
          cursor: '#FFFFFF',
          cursorAccent: '#000000',
          selectionBackground: '#FFFFFF20',
        },
        fontFamily: 'JetBrains Mono, Fira Code, Menlo, Consolas, monospace',
        fontSize: 14,
        scrollback: 10_000,
      });
    }

    if (!fitAddon.current) {
      fitAddon.current = new FitAddon();
      term.current.loadAddon(fitAddon.current);
    }

    term.current.open(terminalRef.current);
    fitAddon.current.fit();
    void window.kleiber.terminals.resize(sessionId, term.current.cols, term.current.rows);

    const onDataDisposable = term.current.onData((data: string) => {
      window.kleiber.sessions.send(sessionId, data).catch((sendError: unknown) => {
        setError(sendError instanceof Error ? sendError.message : 'Failed to send terminal input');
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon.current && term.current) {
        fitAddon.current.fit();
        window.kleiber.terminals.resize(sessionId, term.current.cols, term.current.rows).catch((err: unknown) => {
          console.error('Resize failed', err);
        });
      }
    });
    resizeObserver.observe(terminalRef.current);

    // Initial output load
    window.kleiber.sessions.read(sessionId).then((lines) => {
      if (term.current) {
        for (const line of lines) {
          term.current.write(line + '\r\n');
        }
      }
    }).catch((readError: unknown) => {
      setError(readError instanceof Error ? readError.message : 'Failed to read session output');
    });

    const removeOutputListener = window.kleiber.terminals.onOutput(sessionId, (data: string) => {
      if (term.current) {
        term.current.write(data);
      }
    });

    const removeExitListener = window.kleiber.terminals.onExit(sessionId, (exitCode: number | null) => {
      if (term.current) {
        term.current.write(`\r\n\x1b[31m[Session exited with code ${exitCode}]\x1b[0m\r\n`);
      }

      // Schedule lazy disposal: keep the xterm instance alive for 5 minutes so
      // the user can still scroll through the output.  If the component
      // unmounts before the timer fires it will be cancelled and rescheduled on
      // remount.
      if (disposeTimer.current !== null) clearTimeout(disposeTimer.current);
      disposeTimer.current = setTimeout(() => {
        disposeTimer.current = null;
        term.current?.dispose();
        fitAddon.current = null;
        term.current = null;
        setSessionEnded(true);
      }, LAZY_DISPOSE_DELAY_MS);
    });

    return () => {
      onDataDisposable.dispose();
      resizeObserver.disconnect();
      removeOutputListener();
      removeExitListener();
      // Do NOT dispose the Terminal here — let the lazy-dispose timer handle
      // it.  If there is no pending timer the session is still running and we
      // dispose immediately (component unmounted while session live).
      if (disposeTimer.current === null) {
        term.current?.dispose();
        fitAddon.current = null;
        term.current = null;
      }
    };
  }, [sessionId]);

  return (
    <div className="flex-1 w-full h-full relative flex flex-col" style={{ minHeight: 0 }}>
      {error && <div className="bg-[#EF4444]/10 text-[#EF4444] px-4 py-2 text-xs font-mono border-b border-[#1C1C1C]">{error}</div>}
      {sessionEnded ? (
        <div className="flex-1 flex items-center justify-center text-[#666666] text-sm font-mono select-none">
          Session ended
        </div>
      ) : (
        <div className="flex-1 relative">
          <div ref={terminalRef} className="absolute inset-0 p-2" />
        </div>
      )}
    </div>
  );
};
