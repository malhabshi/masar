import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Test Homepage</h1>
      <p>If you see this, the root page is working.</p>
      <div className="flex gap-4 mt-4">
        <Link href="/login" className="text-blue-500 hover:underline">
          Go to Login Page
        </Link>
        <Link href="/dashboard" className="text-blue-500 hover:underline">
          Go to Dashboard
        </Link>
      </div>
    </main>
  );
}
