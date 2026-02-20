import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold mb-8">Welcome to UniApply Hub</h1>
      <p className="mb-4">If you are seeing this page, the application has started correctly.</p>
      <Link href="/login" className="text-primary hover:underline">
        Proceed to Login
      </Link>
    </main>
  );
}
