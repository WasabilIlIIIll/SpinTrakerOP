// Pas de console en release sous Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    spin_tracker_op_lib::run()
}
