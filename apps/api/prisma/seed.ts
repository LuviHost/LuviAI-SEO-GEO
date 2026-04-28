import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 LuviAI seed başlıyor...');

  // Test admin user
  const admin = await prisma.user.upsert({
    where: { email: 'emirhanburgazli@gmail.com' },
    update: {},
    create: {
      email: 'emirhanburgazli@gmail.com',
      name: 'Emirhan Burgazli',
      role: 'ADMIN',
      plan: 'ENTERPRISE',
      subscriptionStatus: 'ACTIVE',
    },
  });
  console.log(`✓ Admin user: ${admin.email} (${admin.id})`);

  // Test beta user
  const beta = await prisma.user.upsert({
    where: { email: 'beta@luviai.test' },
    update: {},
    create: {
      email: 'beta@luviai.test',
      name: 'Beta Tester',
      role: 'USER',
      plan: 'TRIAL',
      subscriptionStatus: 'TRIAL',
      trialEndsAt: new Date(Date.now() + 14 * 86400000),
    },
  });
  console.log(`✓ Beta user: ${beta.email} (${beta.id})`);

  // Örnek site (LuviHost — dogfooding)
  const site = await prisma.site.upsert({
    where: { id: 'demo-luvihost' },
    update: {},
    create: {
      id: 'demo-luvihost',
      userId: admin.id,
      url: 'https://luvihost.com',
      name: 'LuviHost',
      niche: 'web hosting',
      language: 'tr',
      status: 'ACTIVE',
    },
  });
  console.log(`✓ Site: ${site.name} (${site.url})`);

  console.log('\n✅ Seed tamamlandı');
}

main()
  .catch((e) => {
    console.error('❌ Seed hatası:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
