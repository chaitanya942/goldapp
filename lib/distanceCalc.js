// lib/distanceCalc.js
// Approximate distance between two Indian addresses using PIN-prefix → city lookup
// + a base inter-city distance matrix. Good enough for E-Way Bill (NIC accepts ±10%).
//
// Strategy:
//   1. PIN starts with 5XX → Karnataka, 6XX → Kerala/TN, etc.
//   2. First 3 PIN digits map to a major city (district)
//   3. Look up city-pair in DISTANCE_MATRIX (approx km)
//   4. If unknown city, fall back to state-pair estimate
//   5. If same city (PIN prefix), default to 25 km

// PIN prefix → known city
const PIN_PREFIX_CITY = {
  // Karnataka
  '560': 'Bangalore', '562': 'Bangalore', '563': 'Kolar',
  '570': 'Mysuru',    '571': 'Mysuru',    '572': 'Tumkur',
  '573': 'Hassan',    '574': 'Mangalore', '575': 'Mangalore',
  '576': 'Udupi',     '577': 'Shivamogga','578': 'Davanagere',
  '580': 'Hubli',     '581': 'Hubli',     '583': 'Bellary',
  '585': 'Kalaburagi','586': 'Bijapur',   '587': 'Bagalkot',
  '590': 'Belgaum',   '591': 'Belgaum',
  // Kerala
  '670': 'Kannur',    '671': 'Kasargod',  '673': 'Kozhikode',
  '676': 'Malappuram','678': 'Palakkad',  '679': 'Palakkad',
  '680': 'Thrissur',  '682': 'Kochi',     '683': 'Kochi',
  '684': 'Kochi',     '685': 'Idukki',    '686': 'Kottayam',
  '687': 'Kottayam',  '688': 'Alappuzha', '689': 'Pathanamthitta',
  '690': 'Kollam',    '691': 'Kollam',    '695': 'Thiruvananthapuram',
  '690523': 'Adoor',  '691523': 'Adoor',
  // Andhra Pradesh
  '500': 'Hyderabad', '501': 'Hyderabad', '502': 'Hyderabad',
  '515': 'Anantapur', '516': 'Kadapa',    '517': 'Tirupati',
  '518': 'Kurnool',   '520': 'Vijayawada','521': 'Vijayawada',
  '522': 'Guntur',    '523': 'Ongole',    '524': 'Nellore',
  '530': 'Visakhapatnam','531': 'Vizianagaram', '532': 'Srikakulam',
  '533': 'Kakinada',  '534': 'Eluru',     '535': 'Vizianagaram',
  // Telangana
  '503': 'Nizamabad', '504': 'Adilabad',  '505': 'Karimnagar',
  '506': 'Warangal',  '507': 'Khammam',   '508': 'Nalgonda',
  '509': 'Mahbubnagar',
  // Tamil Nadu
  '600': 'Chennai',   '601': 'Chennai',   '602': 'Chennai',
  '603': 'Chennai',   '605': 'Pondicherry','606': 'Tiruvannamalai',
  '607': 'Cuddalore', '608': 'Cuddalore', '610': 'Tiruchirappalli',
  '611': 'Pudukkottai','612': 'Thanjavur','613': 'Thanjavur',
  '614': 'Pudukkottai','615': 'Tiruchirappalli','616': 'Karur',
  '620': 'Tiruchirappalli','621': 'Tiruchirappalli','622': 'Pudukkottai',
  '623': 'Ramanathapuram','624': 'Dindigul','625': 'Madurai',
  '626': 'Madurai',   '627': 'Tirunelveli','628': 'Thoothukudi',
  '629': 'Kanyakumari','630': 'Sivagangai','632': 'Vellore',
  '635': 'Krishnagiri','636': 'Salem',    '637': 'Namakkal',
  '638': 'Erode',     '641': 'Coimbatore','642': 'Tirupur',
  '643': 'The Nilgiris',
}

// Approximate road distances in km between major cities (one-way).
// Source: rough averages from common map services. Used only when both cities are known.
const DISTANCE_MATRIX = {
  // Bangalore base
  'Bangalore-Mysuru': 145, 'Bangalore-Tumkur': 70, 'Bangalore-Hassan': 190,
  'Bangalore-Mangalore': 350, 'Bangalore-Udupi': 400, 'Bangalore-Shivamogga': 285,
  'Bangalore-Davanagere': 270, 'Bangalore-Hubli': 410, 'Bangalore-Bellary': 310,
  'Bangalore-Kalaburagi': 620, 'Bangalore-Belgaum': 500, 'Bangalore-Kolar': 70,
  'Bangalore-Bijapur': 530, 'Bangalore-Bagalkot': 470,
  'Bangalore-Kochi': 545, 'Bangalore-Thiruvananthapuram': 730,
  'Bangalore-Kannur': 290, 'Bangalore-Kasargod': 285, 'Bangalore-Kozhikode': 350,
  'Bangalore-Malappuram': 410, 'Bangalore-Palakkad': 360, 'Bangalore-Thrissur': 430,
  'Bangalore-Idukki': 500, 'Bangalore-Kottayam': 580, 'Bangalore-Alappuzha': 600,
  'Bangalore-Pathanamthitta': 640, 'Bangalore-Kollam': 670, 'Bangalore-Adoor': 650,
  'Bangalore-Hyderabad': 575, 'Bangalore-Vijayawada': 700, 'Bangalore-Guntur': 670,
  'Bangalore-Visakhapatnam': 1000, 'Bangalore-Anantapur': 215, 'Bangalore-Tirupati': 250,
  'Bangalore-Kurnool': 360, 'Bangalore-Kadapa': 270, 'Bangalore-Nellore': 425,
  'Bangalore-Warangal': 720, 'Bangalore-Nizamabad': 730, 'Bangalore-Karimnagar': 800,
  'Bangalore-Khammam': 800, 'Bangalore-Nalgonda': 620, 'Bangalore-Mahbubnagar': 470,
  'Bangalore-Chennai': 350, 'Bangalore-Coimbatore': 365, 'Bangalore-Salem': 215,
  'Bangalore-Madurai': 460, 'Bangalore-Tiruchirappalli': 330, 'Bangalore-Vellore': 215,
}

// State-pair fallback (rough averages from Bangalore HO perspective)
const STATE_FALLBACK = {
  'KA-KA': 200, 'KA-KL': 500, 'KA-AP': 500, 'KA-TS': 600, 'KA-TN': 350,
  'KL-KA': 500, 'KL-KL': 200, 'KL-TN': 250, 'KL-AP': 800, 'KL-TS': 900,
  'AP-KA': 500, 'AP-AP': 250, 'AP-TS': 350, 'AP-TN': 500, 'AP-KL': 800,
  'TS-KA': 600, 'TS-AP': 350, 'TS-TS': 200, 'TS-TN': 700, 'TS-KL': 900,
  'TN-KA': 350, 'TN-KL': 250, 'TN-AP': 500, 'TN-TS': 700, 'TN-TN': 200,
}

function pinToCity(pin) {
  if (!pin) return null
  const s = String(pin).trim()
  if (s.length < 3) return null
  // Try full 6-digit first, then 3-digit prefix
  return PIN_PREFIX_CITY[s] || PIN_PREFIX_CITY[s.slice(0, 3)] || null
}

// Public: estimate distance in km between two locations
// Either pass cities directly, or pass PINs and we'll resolve.
export function estimateDistanceKm({ fromPin, toPin, fromState, toState }) {
  const fromCity = pinToCity(fromPin)
  const toCity   = pinToCity(toPin)

  // Same PIN → minimum 1 km (NIC won't accept 0)
  if (fromPin && toPin && Number(fromPin) === Number(toPin)) return 1

  if (fromCity && toCity) {
    if (fromCity === toCity) return 25  // intra-city move
    const key1 = `${fromCity}-${toCity}`
    const key2 = `${toCity}-${fromCity}`
    if (DISTANCE_MATRIX[key1]) return DISTANCE_MATRIX[key1]
    if (DISTANCE_MATRIX[key2]) return DISTANCE_MATRIX[key2]
  }

  // Fallback to state-pair averages
  const fs = (fromState || '').toUpperCase()
  const ts = (toState   || '').toUpperCase()
  if (fs && ts) {
    const key = `${fs}-${ts}`
    if (STATE_FALLBACK[key]) return STATE_FALLBACK[key]
  }

  // Last-resort safe default: 100km — NIC tolerates ±10%
  return 100
}
