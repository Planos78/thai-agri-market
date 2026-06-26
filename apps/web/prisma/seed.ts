import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/auth";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

async function main() {
  // --- admin RBAC ---
  const role = await prisma.adminRole.upsert({ where: { name: "admin" }, create: { name: "admin" }, update: {} });
  const permCodes: [string, string][] = [
    ["orders.read", "Read orders"],
    ["orchards.read", "Read orchards"],
    ["orchards.write", "Write orchards"],
    ["lots.read", "Read lots"],
    ["lots.write", "Write lots"],
    ["qc.release", "QC release"],
    ["buyers.read", "Read buyers"],
  ];
  for (const [code, name] of permCodes) {
    const perm = await prisma.permission.upsert({
      where: { code },
      create: { code, name },
      update: {},
    });
    await prisma.adminRolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
      create: { roleId: role.id, permissionId: perm.id },
      update: {},
    });
  }
  await prisma.adminUser.upsert({
    where: { email: "admin@thaiagri.local" },
    create: { email: "admin@thaiagri.local", passwordHash: hashPassword("admin1234"), name: "Admin", roleId: role.id },
    update: { roleId: role.id },
  });

  // --- orchard + lots ---
  const owner = await prisma.user.upsert({
    where: { email: "owner@thaiagri.local" },
    create: { email: "owner@thaiagri.local", name: "เจ้าของสวน", role: "SELLER" },
    update: {},
  });
  let orchard = await prisma.orchard.findFirst({ where: { name: "สวนทุเรียนลุงสมชาย" } });
  if (!orchard) {
    orchard = await prisma.orchard.create({
      data: { name: "สวนทุเรียนลุงสมชาย", province: "จันทบุรี", ownerId: owner.id, isVerified: true },
    });
  }
  if ((await prisma.lot.count({ where: { orchardId: orchard.id } })) === 0) {
    await prisma.lot.createMany({
      data: [
        { orchardId: orchard.id, fruitName: "ทุเรียน", variety: "หมอนทอง", grade: "A", price: 180, quantity: 500, unit: "kg", minOrderQty: 5, status: "ACTIVE", qcStatus: "RELEASED" },
        { orchardId: orchard.id, fruitName: "มังคุด", grade: "A", price: 90, quantity: 300, unit: "kg", status: "ACTIVE", qcStatus: "RELEASED" },
        { orchardId: orchard.id, fruitName: "เงาะ", grade: "B", price: 60, quantity: 400, unit: "kg", status: "ACTIVE", qcStatus: "RELEASED" },
      ],
    });
  }
  // Phase 2: seeded lots must be RELEASED so Phase 1 browse/order stays green
  // (covers lots created before qcStatus existed -> they default to PENDING).
  await prisma.lot.updateMany({ where: { orchardId: orchard.id }, data: { qcStatus: "RELEASED" } });

  // --- verified buyer (LIFF gate) ---
  await prisma.verifiedLineUser.upsert({
    where: { lineUserId: "mock-buyer-1" },
    create: { lineUserId: "mock-buyer-1", phone: "0800000000", name: "ลูกค้าทดสอบ", consent: true },
    update: {},
  });

  console.log("seed done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
