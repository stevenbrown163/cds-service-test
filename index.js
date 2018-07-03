const express = require("express");
const bodyParser = require("body-parser");
const rp = require("request-promise");
const jwt = require("jsonwebtoken");

const app = express();
// Parse JSON body and add to request in the body element.
app.use(bodyParser.json());

// Add some middleware to always send these headers back to the caller. These are required by any EHR.
app.use((req, res, next) => {
    // Allow access to all resources
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Only allow GET/POST/OPTIONS to this endpoint (all that will be used by the EHR)
    res.setHeader('Access-Control-Allow-Method', 'GET, POST, OPTIONS');
    // Allow the EHR to send auth information
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    // Allow only these headers
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Origin, Accept, Content-Location, Location, X-Requested-With');

    // Then forward this request on to the proper handler
    next();
});

// Allow in-line error throwing, for tertiary compare
function _throw(str) {
    throw str;
}

// Great for testing in promise chains
// Usage:
//   some_promise_chain
//   .then(print_then_return)
//   .then(more promise chains)
function print_then_return(a) {
    console.log(JSON.stringify(a, {}, 2));
    return a;
}

// Handle the discovery request, and respond with the available services
function handle_discovery(req, res) {
    console.log("Handling the discovery request");
    // Create the return object
    const PatientView = {
        // Create a list of CDS applications
        services: [
            {
                // Hook into patient-view. Use this when someone opens the patient's chart
                hook: "patient-view",
                // Title the service, at most 140 chars
                title: "Steve's sample patient-view service",
                // A snippet of the application
                description:" Steve's sample patient-view service and application",
                // unique identifier for this service. Also the end of the endpoint for this hook, for example: <CDS-SERVICE-ROOT>/cds-services/patientService
                id: "patientService",
            },
        ],
    };

    // Then return a stringified version of the object
    res.json(PatientView);
}

// Empty function to handle all surprising requests
function handle_all(req, res) {
    console.log("Unimplemented Service:");
    console.log(req.query);
    console.log(req.url);
    console.log(req.method);
    // Respond with an error status 501, and an error code 
    res.status(501).json({
        error: "This service has not been implemented: " + req.url + " using HTTP Method " + req.method
    });
}

// Handle the request for options of the patientService endpoint
function options_patient_view(req, res) {
    console.log("OPTIONS request to patientService");
    // You must send something back to end the request
    res.send();
}

// Handle the post of patient data
async function post_patient_view(req, res) {
    console.log("POST request to patientService");
    // Grab the request body parsed from body-parser
    const body = req.body;
    // 
    const auth = req.headers.authorization;
    const auth_split = auth.split(" ");
    const bearer_token = auth_split[1]

    console.log("\n\nChecking auth_token");
    console.log(jwt.decode(bearer_token));
    console.log("\n\n");
    
    if (body.hook != "patient-view") {
        console.log("BODY HOOK ISN'T RIGHT");
        res.json({error: "Something is terrible here!"});
        return;
    }

    const root = body.fhirServer;
    const patient_id = body.context.patientId;
    const patient_url = `${root}/Immunization`;
    console.log(patient_url);

    const immunizations = await rp({
        uri: patient_url,
        method: "GET",
        headers: {
            "Accept": "application/json+fhir",
        },
        qs: {
            "patient": patient_id
        }
    })
    .then(JSON.parse)
    .then(print_then_return)
    .then(record => { return (record.total == 0 ? _throw("No immmunization Record found") : record.entry) })
    .then(l => l.sort((a, b) => {
        return a.resource.vaccineCode.text.localeCompare(b.resource.vaccineCode.text);
    }))
    .then(print_then_return)
    .then(immun_list => {
        if (!immun_list || immun_list.length == 0)
            return [];

        let markdown_result = "| Vaccination | Expiration Date |\n| :---: | :---: |\n";
        markdown_result += immun_list.map(val => {
            const exp_date = val.resource.expirationDate || "Does not expire";
            return `| ${val.resource.vaccineCode.text} | ${exp_date} |`;
        }).join("\n");

        return [{
            summary: "This patient has received immunizations",
            detail:  markdown_result,
            source: {
                label: "Local Immune Registry",
                url:   "http://www.google.com"
            },
            indicator: "info"
        }];
    })
    .then(cards => {
        res.json({
            cards
        });
    })
    .catch(error => {
        console.log(error);
        res.json({
            cards: []
        });
    });
    console.log("ALL DONE!");
}
app.get("/test1/cds-services", handle_discovery);
app.options("/test1/cds-services", handle_discovery);

app.post("/test1/cds-services/patientService", post_patient_view);
app.options("/test1/cds-services/patientService", options_patient_view);

app.all('*', handle_all);
app.listen(3000);
console.log("LISTENING ON 3000");
