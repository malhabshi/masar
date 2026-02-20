export function ApplicationStatus({ student, currentUser }: any) {
  return (
    <div className="p-4 border rounded">
      <h2 className="text-lg font-semibold">Applications</h2>
      <p>{student?.applications?.length || 0} applications</p>
    </div>
  );
}
