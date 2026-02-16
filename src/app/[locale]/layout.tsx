import { Toaster } from '@/components/ui/toaster';
import { Providers } from '@/components/providers';
import {NextIntlClientProvider} from 'next-intl';
import {getMessages} from 'next-intl/server';
 
export default async function LocaleLayout({
  children,
  params: { locale }
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const messages = await getMessages();
 
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <Providers>
        {children}
        <Toaster />
      </Providers>
    </NextIntlClientProvider>
  );
}
