"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bug, ChevronDown, ClipboardCopy, Trash2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface DebugLoggerProps {
  heading?: string;
  logs: string[];
  clearLogs: () => void;
}

export function DebugLogger({ heading = "Detailed Debug Logs", logs, clearLogs }: DebugLoggerProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(logs.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  };

  const resolveLogTone = (line: string) => {
    if (/\[(error|fail|failure)\]/i.test(line)) {
      return "text-red-500 dark:text-red-400";
    }
    if (/\[(warn|warning)\]/i.test(line)) {
      return "text-yellow-600 dark:text-yellow-400";
    }
    if (/\[(success|ok)\]/i.test(line)) {
      return "text-emerald-500 dark:text-emerald-400";
    }
    return "text-muted-foreground";
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <button
            type="button"
            className="flex items-center gap-2 text-left focus:outline-none"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
          >
            <ChevronDown
              size={16}
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            />
            <span className="flex items-center gap-2">
              <Bug size={16} />
              {heading}
              <span className="text-sm font-normal text-muted-foreground">
                ({logs.length} entries)
              </span>
            </span>
          </button>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={copyToClipboard}
              disabled={logs.length === 0}
            >
              {copied ? (
                <span className="flex items-center gap-1">
                  <Check className="h-4 w-4" />
                  Copied
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <ClipboardCopy className="h-4 w-4" />
                  Copy
                </span>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={clearLogs}
              disabled={logs.length === 0}
            >
              <span className="flex items-center gap-1">
                <Trash2 className="h-4 w-4" />
                Clear
              </span>
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      {expanded && (
        <CardContent>
          <div className="h-64 overflow-y-auto rounded-md border bg-muted p-3 font-mono text-xs space-y-1">
            {logs.length === 0 ? (
              <div className="text-muted-foreground">Debug information will appear here...</div>
            ) : (
              logs.map((line, idx) => (
                <pre
                  key={`${idx}-${line}`}
                  className={cn(
                    "whitespace-pre-wrap break-words",
                    resolveLogTone(line),
                  )}
                >
                  {line}
                </pre>
              ))
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
