import React, { useEffect, useRef, useState } from 'react';
import { UUID } from '@kleiber/shared';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

export interface TerminalPaneProps {
  sessionId: UUID;
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({ sessionId }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;
    setError(null);

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
    fitAddon.current = new FitAddon();
    term.current.loadAddon(fitAddon.current);

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
      {error && <div className="bg-[#EF4444]/10 text-[#EF4444] px-4 py-2 text-xs font-mono border-b border-[#1C1C1C]">{error}</div>}
      <div className="flex-1 relative">
        <div ref={terminalRef} className="absolute inset-0 p-2" />
      </div>
    </div>
  );
};
