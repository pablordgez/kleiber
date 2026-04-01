import React, { useEffect, useRef, useState } from 'react';
import { UUID } from '@kleiber/shared';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export interface TerminalPaneProps {
  sessionId: UUID;
  sessionName: string;
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({ sessionId, sessionName }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    term.current = new Terminal({
      theme: {
        background: '#09090B',
        foreground: '#A1A1AA',
      },
      fontFamily: 'monospace',
      fontSize: 14,
    });
    fitAddon.current = new FitAddon();
    term.current.loadAddon(fitAddon.current);
    
    term.current.open(terminalRef.current);
    fitAddon.current.fit();

    const onDataDisposable = term.current.onData((data: string) => {
      window.kleiber.sessions.send(sessionId, data).catch((err: any) => {
        if (!error) setError(err.message);
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon.current && term.current) {
        fitAddon.current.fit();
        window.kleiber.terminals.resize(sessionId, term.current.cols, term.current.rows).catch((err: any) => {
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
    }).catch((err: any) => setError(err.message));

    const removeOutputListener = window.kleiber.terminals.onOutput(sessionId, (data: string) => {
      if (term.current) {
        term.current.write(data);
      }
    });

    const removeExitListener = window.kleiber.terminals.onExit(sessionId, (exitCode: number | null) => {
      if (term.current) {
        term.current.write(`\r\n\x1b[31m[Session exited with code ${exitCode}]\x1b[0m\r\n`);
      }
    });

    return () => {
      onDataDisposable.dispose();
      resizeObserver.disconnect();
      removeOutputListener();
      removeExitListener();
      term.current?.dispose();
    };
  }, [sessionId]);

  return (
    <div className="flex-1 w-full h-full relative flex flex-col" style={{ minHeight: 0 }}>
      {error && <div className="bg-red-900/50 text-red-200 p-2 text-xs font-mono border-b border-red-900">{error}</div>}
      <div className="flex-1 relative">
        <div ref={terminalRef} className="absolute inset-0 p-2" />
      </div>
    </div>
  );
};
