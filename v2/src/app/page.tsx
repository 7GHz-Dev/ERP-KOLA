import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { homePageFor } from '@/lib/home-page';

export default async function Home() {
  const user = await currentUser();
  redirect(user ? homePageFor(user.role) : '/login');
}
