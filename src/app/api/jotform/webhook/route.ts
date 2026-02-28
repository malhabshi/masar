
import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ message: 'Jotform integration has been removed.' }, { status: 404 });
}
