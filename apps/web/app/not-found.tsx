import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="globalLoading">
      <strong>Workspace not found</strong>
      <span>The requested CodeER route does not exist or is unavailable.</span>
      <Link className="buttonLink" href="/command-center">
        Return to command center
      </Link>
    </div>
  );
}
