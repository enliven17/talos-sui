"use client";

import { useEffect, useState } from "react";

/**
 * Boot splash — shows for ~800 ms then fades out.
 *
 * Branded for the Tatum × Sui × Walrus build so judges & first-time
 * visitors see the integration partners before the dashboard loads.
 */
export function SplashScreen() {
  const [isVisible, setIsVisible] = useState(true);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const exitTimer = setTimeout(() => setIsExiting(true), 800);
    const removeTimer = setTimeout(() => setIsVisible(false), 1200);
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-background transition-opacity duration-300 ease-in-out ${
        isExiting ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <div className="flex flex-col items-center gap-6">
        {/* Core Logo with Ruthie font */}
        <div className="relative">
          <h1 className="text-7xl md:text-8xl font-ruthie text-nav-accent flex gap-x-2">
            {"Talos".split("").map((char, i) => (
              <span
                key={i}
                className="animate-letter-in inline-block text-center"
                style={{ animationDelay: `${i * 0.06}s` }}
              >
                {char}
              </span>
            ))}
          </h1>
          <div className="absolute inset-0 bg-accent/20 blur-3xl rounded-full scale-150 animate-pulse-subtle -z-10" />
        </div>

        {/* Loading detail */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-48 h-[1px] bg-border overflow-hidden relative">
            <div className="absolute inset-0 bg-accent w-1/3 animate-loading-bar" />
          </div>
          <span className="text-[10px] uppercase tracking-[0.3em] text-muted font-mono animate-pulse">
            Booting agent runtime
          </span>
        </div>

        {/* Powered-by badges (Tatum + Sui + Walrus) */}
        <div className="mt-6 flex items-center gap-4 text-[10px] uppercase tracking-[0.25em] text-muted font-mono">
          <span>SUI</span>
          <span className="text-border">·</span>
          <span>WALRUS</span>
          <span className="text-border">·</span>
          <span>TATUM</span>
        </div>
      </div>
    </div>
  );
}
