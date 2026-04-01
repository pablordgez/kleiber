import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { ApiClient } from "../api/api";
import { Maximize2, Trash2 } from "lucide-react";

interface TerminalViewProps {
  projectId: string;
  sessionId: string;
  sessionName: string;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ projectId, sessionId, sessionName }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const outputWsRef = useRef<WebSocket | null>(null);
  const inputWsRef = useRef<WebSocket | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#000000",
        foreground: "#E5E5E5",
        cursor: "#FFFFFF",
        cursorAccent: "#000000",
        selectionBackground: "#FFFFFF20",
      },
      fontFamily: "JetBrains Mono, Fira Code, Menlo, Consolas, monospace",
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const handleResize = () => fitAddon.fit();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
    };
  }, []);

  useEffect(() => {
    if (!xtermRef.current) return;
    const term = xtermRef.current;
    term.clear();
    setError("");
    setStatus("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const token = (ApiClient as any).getToken?.() || sessionStorage.getItem("kleiber_token");

    if (!token) {
      setError("No authentication token found");
      return;
    }

    let outputWs: WebSocket | null = null;
    let inputWs: WebSocket | null = null;
    let isMounted = true;
    let inputReady = false;

    const connectOutput = () => {
      outputWs = new WebSocket(`${protocol}//${host}/ws/sessions/${sessionId}/output`);
      outputWsRef.current = outputWs;

      outputWs.onopen = () => {
        if (!isMounted) return;
        outputWs?.send(JSON.stringify({ token }));
      };

      outputWs.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "ready") {
            setStatus("connected");
          } else if (msg.type === "snapshot" && msg.output) {
            term.write(msg.output.replace(/\n/g, "\r\n"));
          } else if (msg.type === "output" && msg.chunk) {
            term.write(msg.chunk);
          } else if (msg.type === "exit") {
            term.write(`\r\n\x1b[33m[Session exited with code ${msg.exitCode}]\x1b[0m\r\n`);
          }
        } catch (err) {
          console.error("Failed to parse output ws message", err);
        }
      };

      outputWs.onerror = () => {
        if (isMounted) setError("WebSocket connection error");
      };

      outputWs.onclose = () => {
        if (isMounted) {
          setStatus("disconnected");
          // Reconnect logic could be added here
        }
      };
    };

    const connectInput = () => {
      inputWs = new WebSocket(`${protocol}//${host}/ws/sessions/${sessionId}/input`);
      inputWsRef.current = inputWs;

      inputWs.onopen = () => {
        if (!isMounted) return;
        inputWs?.send(JSON.stringify({ token }));
      };

      inputWs.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "ready") {
            inputReady = true;
          }
        } catch (err) {
          console.error("Failed to parse input ws message", err);
        }
      };
    };

    connectOutput();
    connectInput();

    const dataListener = term.onData((data) => {
      if (inputWs?.readyState === WebSocket.OPEN && inputReady) {
        inputWs.send(JSON.stringify({ input: data }));
      }
    });

    return () => {
      isMounted = false;
      dataListener.dispose();
      outputWs?.close();
      inputWs?.close();
      outputWsRef.current = null;
      inputWsRef.current = null;
    };
  }, [sessionId]);

  const handleKill = async () => {
    try {
      await ApiClient.killSession(projectId, sessionId);
    } catch (err: any) {
      setError(err.message || "Failed to kill session");
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#000000]">
      <div className="h-9 w-full bg-[#000000] border-b border-[#1C1C1C] flex items-center px-4 justify-between shrink-0">
        <div className="flex items-center gap-2 text-[13px] text-[#FFFFFF] font-medium truncate">
          <span>{sessionName}</span>
          <span className="ml-2 text-[10px] text-[#666666] uppercase">
            {status}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              xtermRef.current?.clear();
            }}
            className="text-xs text-[#666666] hover:text-[#FFFFFF] hover:bg-[#141414] px-2 py-1 rounded-lg transition-colors"
          >
            Clear
          </button>
          <button
            onClick={handleKill}
            className="text-xs text-[#EF4444] hover:bg-[#EF4444]/10 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
          >
            <Trash2 size={13} />
            Kill
          </button>
        </div>
      </div>
      
      {error && <div className="bg-[#EF4444]/10 text-[#EF4444] px-4 py-2 text-xs font-mono border-b border-[#1C1C1C]">{error}</div>}
      
      <div className="flex-1 relative">
        <div ref={terminalRef} className="absolute inset-0 p-2" />
      </div>
    </div>
  );
};
