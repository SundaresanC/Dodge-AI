import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...\n");

  const passwordHash = await bcrypt.hash("Demo1234", 12);

  const user = await prisma.user.upsert({
    where: { email: "demo@sap-o2c.app" },
    update: {},
    create: {
      id: "seed-user-1",
      email: "demo@sap-o2c.app",
      name: "Alex Chen",
      passwordHash,
      timezone: "Asia/Kolkata",
      preferences: { theme: "dark" },
    },
  });
  console.log(`  User: ${user.email} (password: Demo1234)`);

  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
