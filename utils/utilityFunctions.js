import 'dotenv/config';

export const numDifferentiation = (value) => {
    if (value >= 10000000) { // Crore
        return (value / 10000000).toFixed(1).replace(/\.0$/, '') + ' Cr';
    }
    if (value >= 100000) { // Lakh
        return (value / 100000).toFixed(1).replace(/\.0$/, '') + ' Lac';
    }
    if (value >= 1000) { // Thousand
        return (value / 1000).toFixed(1).replace(/\.0$/, '') + ' K';
    }
    return value.toString();
};

export const formatIsoDateToCustomString = (isoDateString) => {
    const date = new Date(isoDateString);
    const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
};

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

export { PORT, HOST };


