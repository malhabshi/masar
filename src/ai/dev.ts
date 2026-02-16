'use server';
import { config } from 'dotenv';
config();

import '@/ai/flows/customize-application-questions.ts';
import '@/ai/flows/extract-ielts-flow.ts';
import '@/ai/flows/extract-passport-info-flow.ts';
