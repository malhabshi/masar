import Link from "next/link";

export default function TestPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Test Page</h1>
      <Link href="/" className="text-blue-500 hover:underline">
        Go Home
      </Link>
    </main>
  );
}
