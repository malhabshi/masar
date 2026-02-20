export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Student ID: {id}</h1>
      <p className="mt-4">✅ Dynamic routes work!</p>
    </div>
  );
}
