fn main() {
    // Tell cargo to use the system protoc
    println!("cargo:rerun-if-env-changed=PROTOC");
}