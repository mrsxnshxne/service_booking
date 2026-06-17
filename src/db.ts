import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
