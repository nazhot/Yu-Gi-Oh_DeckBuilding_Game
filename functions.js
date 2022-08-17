function readyButton(button){
    let buttonText = button.innerHTML;
    if (buttonText === "READY"){
        button.innerHTML = "NOT READY";
        button.style.backgroundColor = "darkred";
    } else {
        button.innerHTML = "READY";
        button.style.backgroundColor = "darkgreen";
    }
}