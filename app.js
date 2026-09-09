const axios = require("axios");

const getCurrentDate = () => {
  const currentDate = new Date();
  const year = currentDate.getFullYear();
  const month = (currentDate.getMonth() + 1).toString().padStart(2, "0");
  const day = currentDate.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const authenticate = async () => {
  const authenticationUrl = "http://127.0.0.1:8081/jwt-api-token-auth/";
  const credentials = {
    username: "admin",
    password: "admin",
  };

  const axiosConfig = {
    headers: {
      "Content-Type": "application/json",
    },
  };

  try {
    const response = await axios.post(authenticationUrl, credentials, axiosConfig);
    const token = response.data.token;
    console.log("Authentication successful.");
    return token;
  } catch (error) {
    console.error("Authentication failed. Error:", error.response ? error.response.data : error.message);
    throw error;
  }
};

const fetchDataAndPost = async () => {
  try {
    const authToken = await authenticate();

    const localApiLink = `http://127.0.0.1:8081/att/api/firstLastReport/?page=1&page_size=100000&start_date=${getCurrentDate()}&end_date=${getCurrentDate()}&departments=1&areas=-1&groups=-1&employees=-1`;

    const axiosConfig = {
      headers: {
        Authorization: `JWT ${authToken}`,
      },
    };

    const apiResponse = await axios.get(localApiLink, axiosConfig);
    const selectResult = apiResponse?.data?.data;

    console.log("Data fetched successfully.");

    // New API where we want to send the data
    const externalApiUrl = "https://server.roohschool.edu.bd/server/postAttendence";

    // Prepare data for the POST request
    const postData = selectResult?.map((row) => ({
      empID: row.emp_code,
      empName: `${row.first_name} ${row.last_name}`,
      date: row.att_date,
      inTime: row.first_punch,
      outTime: row.last_punch,
      total_time: row.total_time,
    }));

    // Loop through the data and send it to the new API
    for (const data of postData) {
      try {
        const postResponse = await axios.post(externalApiUrl, data, {
          headers: {
            "Content-Type": "application/json",
          },
        });
        console.log(`Data posted for empID: ${data.empID}`, postResponse.data);
      } catch (postError) {
        console.error(`Error posting data for empID: ${data.empID}`, postError.response ? postError.response.data : postError.message);
      }
    }
  } catch (error) {
    console.error("Error:", error);
  }
};

fetchDataAndPost();

const startFetchingData = () => {
  setInterval(async () => {
    await fetchDataAndPost();
  }, 900000); // Every 15 minutes
};

startFetchingData();
