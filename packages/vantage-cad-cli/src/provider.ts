export type CliProviderChoice="managed"|"team_api"|"personal_byok"|"local_openai"|"claude_code_personal";
export function providerPolicy(choice:CliProviderChoice,input:{platformAdmin:boolean;matchingDevice:boolean;privateSession:boolean;interactive:boolean;explicitOptIn:boolean}){
 if(choice==="claude_code_personal"&&(!input.platformAdmin||!input.matchingDevice||!input.privateSession||!input.interactive||!input.explicitOptIn))throw new Error("Claude Code is personal local use only");
 const billingSource={managed:"Vantage managed allowance/credits",team_api:"Team or platform API billing",personal_byok:"Personal provider API account",local_openai:"Local model host",claude_code_personal:"Personal Claude Code consumer subscription; private local owner use only"}[choice];
 return{choice,billingSource,consumerSubscriptionIsApiCredential:false};
}
