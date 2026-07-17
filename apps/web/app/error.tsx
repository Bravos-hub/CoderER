'use client';
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="globalLoading">
      <strong>Command center encountered an error</strong>
      <span>{error.message}</span>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
