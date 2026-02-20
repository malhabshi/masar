export function StudentTermSelector({ student, currentUser }: any) {
  return (
    <div className="p-4 border rounded">
      <h2 className="text-lg font-semibold">Term</h2>
      <p>{student?.term || 'Not set'}</p>
    </div>
  );
}
