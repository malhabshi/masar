export function StudentHeader({ student, currentUser }: any) {
  return (
    <div className="p-4 border-b">
      <h1 className="text-2xl font-bold">{student?.name || 'Student'}</h1>
    </div>
  );
}
