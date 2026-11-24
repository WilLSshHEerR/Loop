const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const prospects = [
    { id: '00000000-0000-4000-8000-000000000001', businessName: 'Consultorio Dental Ejemplo Uno', category: 'Consultorio dental', city: 'Ciudad de México', state: 'Ciudad de México', email: 'demo1@example.invalid' },
    { id: '00000000-0000-4000-8000-000000000002', businessName: 'Consultorio Dental Ejemplo Dos', category: 'Consultorio dental', city: 'Ciudad de México', state: 'Ciudad de México', email: 'demo2@example.invalid' },
    { id: '00000000-0000-4000-8000-000000000003', businessName: 'Consultorio Dental Ejemplo Tres', category: 'Consultorio dental', city: 'Naucalpan de Juárez', state: 'Estado de México', email: 'demo3@example.invalid' },
    { id: '00000000-0000-4000-8000-000000000004', businessName: 'Consultorio Dental Ejemplo Cuatro', category: 'Consultorio dental', city: 'Toluca de Lerdo', state: 'Estado de México', email: 'demo4@example.invalid' },
    { id: '00000000-0000-4000-8000-000000000005', businessName: 'Consultorio Dental Ejemplo Cinco', category: 'Consultorio dental', city: 'Ecatepec de Morelos', state: 'Estado de México', email: 'demo5@example.invalid' },
  ];

  for (const prospect of prospects) {
    await prisma.prospect.upsert({
      where: { id: prospect.id },
      update: {},
      create: prospect,
    });
  }

  console.log('Seed aplicado: 5 prospectos ficticios.');
}

main()
  .catch(() => {
    console.error('No se pudieron cargar los datos de ejemplo.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
