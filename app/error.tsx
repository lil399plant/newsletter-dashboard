"use client";

export default function Error({ error }: { error: Error }) {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="font-mono text-xs text-red-400 max-w-2xl px-6">
        <p className="text-zinc-500 mb-2">render error</p>
        <p>{error.message}</p>
        <pre className="mt-3 text-zinc-600 whitespace-pre-wrap">{error.stack}</pre>
      </div>
    </main>
  );
}
