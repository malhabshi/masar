// This layout is simplified for debugging.
// The authentication check and sidebar have been temporarily removed.

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="p-6">
      <div className="border border-red-500 p-4 rounded-lg mb-4">
        <h1 className="text-xl font-bold text-red-700">DEBUG MODE</h1>
        <p className="text-sm">App layout is in debug mode. Authentication and sidebar are disabled.</p>
      </div>
      {children}
    </main>
  );
}
