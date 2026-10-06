import { expect, test } from "@playwright/test";
import { signInAs } from "./session";
test("competition starts with scouting and one task selector",async({page,context})=>{
 test.setTimeout(180000);expect(await signInAs(context,"owner")).toBe(true);await page.goto("/competition");
 await expect(page.getByRole("heading",{level:1,name:"Scout",exact:true})).toBeVisible({timeout:60000});
 await expect(page.getByRole("combobox",{name:"Competition section",exact:true})).toHaveCount(0);
 const task=page.getByRole("tablist",{name:"Scouting task",exact:true});await expect(task).toBeVisible({timeout:60000});
 await expect(task.getByRole("tab",{name:"Match",exact:true})).toHaveAttribute("aria-selected","true");
 await task.getByRole("tab",{name:"Pit",exact:true}).click();await expect(task.getByRole("tab",{name:"Pit",exact:true})).toHaveAttribute("aria-selected","true");
 await task.getByRole("tab",{name:"Match",exact:true}).click();await expect(task.getByRole("tab",{name:"Match",exact:true})).toHaveAttribute("aria-selected","true");
 await expect(task.getByRole("tab",{name:"Scouted teams",exact:true})).toHaveCount(0);await expect(page.getByRole("dialog")).toHaveCount(0);
});
