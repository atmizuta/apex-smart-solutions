import { NextResponse } from 'next/server';
import { listarCenariosAtivos } from '@/db/cenarios';

export async function GET() {
  const cenarios = await listarCenariosAtivos();
  return NextResponse.json(cenarios);
}
