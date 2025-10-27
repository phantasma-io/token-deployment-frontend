"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DebugLoggerProps {
  heading?: string;
  logs: string[];
  clearLogs: () => void;
}

export function DebugLogger({ heading = "Detailed Debug Logs", logs, clearLogs }: DebugLoggerProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(logs.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            🐛 {heading}
            <span className="text-sm font-normal text-muted-foreground">
              ({logs.length} entries)
            </span>
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={copyToClipboard}
              disabled={logs.length === 0}
            >
              {copied ? "✓ Copied" : "📋 Copy"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={clearLogs}
              disabled={logs.length === 0}
            >
              🗑️ Clear
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <textarea
          className="w-full h-64 p-3 font-mono text-xs bg-muted border rounded-md resize-none overflow-y-auto"
          value={logs.join('\n')}
          readOnly
          placeholder="Debug information will appear here..."
        />
      </CardContent>
    </Card>
  );
}
