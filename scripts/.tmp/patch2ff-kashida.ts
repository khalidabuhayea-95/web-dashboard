import prisma from "@/lib/prisma";
const ID = "2ff48616-118b-4c4a-a099-78ca0b6e4356";
async function main() {
  const t: any = await prisma.template.findUnique({ where: { id: ID } });
  const data = JSON.parse(JSON.stringify(t.data));
  const o = data.objects.find((x: any) => x.importNodeId === "LB1RkLSZZH2Zn6PN");
  console.log("before", o.width, o.text.length, o.textAlign);
  // Left-aligned: the extra width only grows to the right, where the line meets «عروسـ».
  o.width = 520;
  await prisma.template.update({ where: { id: ID }, data: { data } });
  const after = await prisma.template.findUnique({ where: { id: ID }, select: { updatedAt: true } });
  console.log("after", o.width, "updatedAt", after!.updatedAt.toISOString());
}
main().finally(() => prisma.$disconnect());
