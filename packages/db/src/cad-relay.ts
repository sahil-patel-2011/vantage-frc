import { Pool } from "@neondatabase/serverless";
let pool:Pool|undefined;
export function getCadRelayPool(){if(!pool){const connectionString=process.env.DATABASE_CAD_RELAY_URL;if(!connectionString){if(process.env.NODE_ENV==="production")throw new Error("DATABASE_CAD_RELAY_URL is required");return new Pool({connectionString:process.env.DATABASE_URL??"postgresql://vantage:local@localhost:5432/vantage"});}pool=new Pool({connectionString});}return pool;}
