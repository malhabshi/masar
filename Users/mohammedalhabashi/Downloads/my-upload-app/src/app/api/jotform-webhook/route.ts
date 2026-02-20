// This endpoint is disabled.
// The server-side webhook handler cannot directly access the client-side data context
// or Firebase services with user permissions, so it cannot add entries to the application.
// A WhatsApp notification was used as a workaround, but this has been removed to avoid confusion.
// For bulk data entry, please use the "Import Students" feature which accepts Excel/CSV files.
export async function POST() {
  return new Response(
    JSON.stringify({ message: 'This Jotform integration is disabled.' }),
    {
      status: 410, // Gone
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
