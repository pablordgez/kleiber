import React, { useState } from "react";
import { ApiClient } from "../api/api";
import { Lock } from "lucide-react";

interface AuthScreenProps {
  onLogin: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { token } = await ApiClient.login(username, password);
      ApiClient.setToken(token);
      onLogin();
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#000000] text-[#FFFFFF] p-4">
      <div className="w-full max-w-sm rounded-lg border border-[#1C1C1C] bg-[#0A0A0A] p-6 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1C1C1C]">
            <Lock size={24} className="text-[#FFFFFF]" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Kleiber Remote</h1>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && <div className="rounded-lg bg-[#EF4444]/10 p-3 text-sm text-[#EF4444] border border-[#EF4444]/20">{error}</div>}
          
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-[#666666]" htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-10 rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] focus:border-[#333333] focus:outline-none transition-colors"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-[#666666]" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 rounded-lg border border-[#1C1C1C] bg-[#000000] px-3 py-2 text-sm text-[#FFFFFF] focus:border-[#333333] focus:outline-none transition-colors"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="mt-2 h-10 w-full rounded-lg bg-[#FFFFFF] text-[#000000] text-sm font-medium transition-colors hover:bg-[#E5E5E5] disabled:opacity-50"
          >
            {loading ? "Connecting..." : "Connect"}
          </button>
        </form>
      </div>
    </div>
  );
};
