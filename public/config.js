// Config web de Firebase. NO es secreta: viaja en el bundle de cualquier cliente.
// Lo que protege la base son firestore.rules, no esconder estos valores.
//
// Para regenerarla:  firebase apps:sdkconfig web --project el-sotano-bar
window.CONFIG_FIREBASE = {
  apiKey: "AIzaSyDWGHZ3EoBaEGX4ECrt2plVyjZnDminteY",
  authDomain: "el-sotano-bar.firebaseapp.com",
  projectId: "el-sotano-bar",
  storageBucket: "el-sotano-bar.firebasestorage.app",
  messagingSenderId: "778763133855",
  appId: "1:778763133855:web:6d04d31272dcf5209093aa"
};

// Ajustes del local
window.CONFIG_BAR = {
  nombre: "El Sótano",
  moneda: "$",
  // Mesas que existen en el salón (para el QR y el panel de barra)
  mesas: ["1","2","3","4","5","6","7","8","9","10","Barra","Para llevar"],
  // Minutos tras los cuales un pedido "nuevo" se marca como demorado en el panel
  alertaDemoraMin: 8
};
