export const dataCenterMap = {
  US: "https://www.zohoapis.com",
  EU: "https://www.zohoapis.eu",
  AU: "https://www.zohoapis.com.au",
  IN: "https://www.zohoapis.in",
  China: "https://www.zohoapis.com.cn",
  JP: "https://www.zohoapis.jp",
};

export const conn_name = "zoho_crm_conn";

// Applications_History module: API name for the Stakeholder/Account lookup field.
// If stakeholder doesn't transfer when moving history, change to your module's field API name
// (e.g. "Account", "Stakeholder1", "Related_Account"). Check Setup > Developer Hub > API Names.
export const APPLICATIONS_HISTORY_STAKEHOLDER_FIELD = "Stakeholder";

// Related list API name for Applications_History on the Applications module.
// Used when the widget is embedded on Applications to fetch history records.
// Try "Application_History" or "Applications_History" depending on your Zoho setup.
export const APPLICATIONS_RELATED_LIST_HISTORY = "Application_History";

// Module entity names that indicate the widget is on an Application record.
// Zoho returns Entity from PageLoad - add variants if your setup uses different names.
export const APPLICATIONS_MODULE_NAMES = ["Applications", "Applications1", "Deals"];

export const access_token_api_url =
  "https://api.easy-pluginz.com.au/admin/v2/data/zoho/crm/downloadattachment";

export const access_token_url =
  "https://www.zohoapis.com.au/crm/v2/functions/getaccesstoken/actions/execute?auth_type=apikey&zapikey=1003.36fcc30cd4dabc6754397103d572d959.45911087afc5315f107424ed9617687b";
