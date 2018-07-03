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
function handle_options(req, res) {
    console.log("OPTIONS request to patientService");
    // You must send something back to end the request
    res.send();
}

// Handle the post of patient data
async function post_patient_view(req, res) {
    console.log("POST request to patientService");
    // Grab the request body parsed from body-parser
    const body = req.body;
    // Get the JWT auth token
    const auth = req.headers.authorization;
    // Parse the JWT. It will be sent as "Bearer token_here"
    const auth_split = auth.split(" ");
    const bearer_token = auth_split[1];

    // Decode the JWT. We don't do any check with it right now...
    console.log(jwt.decode(bearer_token));
    
    // If the hook doesn't match what we expect, something has gone wrong
    if (body.hook != "patient-view") {
        console.log("CDS Hook doesn't match what was expected: ", body.hook);
        res.status(400).json({error: "CDS Hook doesn't match what was expected"});
        return;
    }

    // Grab the fhirServer from the request. Points us towards the FHIR service for upcoming FHIR requests
    const root = body.fhirServer;
    const patient_id = body.context.patientId;
    // Evaluates to https://some.fhir.server/version/.../Immunization
    const patient_url = `${root}/Immunization`;

    // Use the request-promise package to call the FHIR server to get the Immunization record
    const immunizations = await rp({
        // Set the Immunization URL
        uri: patient_url,
        method: "GET",
        // This is required by the FHIR standard to identify the format of the request
        headers: {
            "Accept": "application/json+fhir",
        },
        // Format the query parameters: ".../Immunization?patient=patient_id
        qs: {
            "patient": patient_id
        }
    })
    // Parse stringified response
    .then(JSON.parse)
    // If there is no Immunization record, then get out of the loop by throwing an error to go to the catch statement
    // If there is an Immunization record, then return the list of Immunizations for in the entry element.
    .then(record => (record.total == 0 ? _throw("No immmunization Record found") : record.entry))
    // Sort the list by the vaccine Code text, so they appear in order to the user
    .then(l => l.sort((a, b) => {
        return a.resource.vaccineCode.text.localeCompare(b.resource.vaccineCode.text);
    }))
    // Parse the list of immunizations
    .then(immun_list => {
        // If the list is empty, then return early (should be caught above but you never know...)
        if (!immun_list || immun_list.length == 0)
            return [];

        // Initialize the markdown string, we start with two table headers;
        // Vaccination        Expiration Date
        // ------------------ ----------------
        let markdown_result = "| Vaccination | Expiration Date |\n| :---: | :---: |\n";
        // add to the result a stringified version of the object
        // adds a row for vaccination, putting in the first column the name of the vaccination,
        // and in the second column the expiration date of the vaccination. If that is empty, then some default text
        markdown_result += immun_list.map(val => {
            const exp_date = val.resource.expirationDate || "Does not expire";
            return `| ${val.resource.vaccineCode.text} | ${exp_date} |`;
        }).join("\n");

        // then return the cards object with some required fields
        return [{
            summary: "This patient has received immunizations",
            // Send the markdown result in detail
            detail:  markdown_result,
            source: {
                label: "Your Immune Registry",
                url:   ""
            },
            // Only use info cards
            indicator: "info"
        }];
    })
    // Wrap up the response in an object with a single element, cards
    .then(cards => {
        res.json({
            cards
        });
    })
    .catch(error => {
        // If there was a problem, it is likely because we got out early, ie, there were no immune records.
        // Either way, print the error, then return an empty object
        console.log(error);
        res.json({
            cards: []
        });
    });
}
app.get("/test1/cds-services", handle_discovery);
app.options("/test1/cds-services", handle_options);

app.post("/test1/cds-services/patientService", post_patient_view);
app.options("/test1/cds-services/patientService", handle_options);

// Handle any other requests you weren't expecting. Only use this in testing. Remove before going forward. All scenarios should be handled properly
app.all('*', handle_all);
// Listen on 3000, this number is arbritrary, but should match NGINX config
app.listen(3000);
console.log("LISTENING ON 3000");
