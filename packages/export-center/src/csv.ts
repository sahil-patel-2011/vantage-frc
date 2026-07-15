export type CsvValue=string|number|boolean|Date|null|undefined|Record<string,unknown>|unknown[];
export function flattenJson(value:unknown,prefix="",output:Record<string,string>={}):Record<string,string>{
 if(value===null||value===undefined){if(prefix)output[prefix]="";return output;}
 if(Array.isArray(value)){output[prefix]=JSON.stringify(value);return output;}
 if(typeof value==="object"){for(const key of Object.keys(value as Record<string,unknown>).sort())flattenJson((value as Record<string,unknown>)[key],prefix?`${prefix}.${key}`:key,output);return output;}
 output[prefix]=String(value);return output;
}
export function safeCsvCell(value:CsvValue){let text=value instanceof Date?value.toISOString():typeof value==="object"&&value!==null?JSON.stringify(value):String(value??"");if(/^[=+\-@]/.test(text))text=`'${text}`;return`"${text.replace(/"/g,'""')}"`;}
export function csvHeader(columns:string[],excelBom=false){return`${excelBom?"\uFEFF":""}${columns.map(safeCsvCell).join(",")}\r\n`;}
export function csvRow(columns:string[],row:Record<string,CsvValue>){return`${columns.map(column=>safeCsvCell(row[column])).join(",")}\r\n`;}
export async function* streamCsv(columns:string[],rows:AsyncIterable<Record<string,CsvValue>>,options:{excelBom?:boolean;chunkRows?:number}={}){
 yield csvHeader(columns,options.excelBom);let chunk="",count=0;for await(const row of rows){chunk+=csvRow(columns,row);count++;if(count>=(options.chunkRows??500)){yield chunk;chunk="";count=0;}}if(chunk)yield chunk;
}
